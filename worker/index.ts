/**
 * Cloudflare Worker: serves the static build and routes /ws/:code to a Room Durable Object.
 * One Room per game code. The Room is the single source of truth for buzz ordering.
 */
import { DurableObject } from 'cloudflare:workers';
import { newGame, reduce, redact, toDeck, type Deck } from '../src/lib/game';
import type { ClientMsg, Game, ServerMsg } from '../src/lib/types';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

const CODE = /^\/ws\/([A-Z0-9]{4,8})$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const m = CODE.exec(new URL(req.url).pathname);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket')
        return new Response('Expected WebSocket', { status: 426 });
      return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  id: string;
}

export class Room extends DurableObject<Env> {
  private game!: Game;
  private deck: Deck | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.game = (await ctx.storage.get<Game>('game')) ?? newGame('');
      this.deck = (await ctx.storage.get<Deck>('deck')) ?? null;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const code = CODE.exec(new URL(req.url).pathname)![1];
    if (!this.game.code) this.game = { ...this.game, code };
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify(this.stateFor(null)));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return ws.send(JSON.stringify({ t: 'error', msg: 'bad json' } satisfies ServerMsg));
    }
    if (msg.t === 'ping') return ws.send(JSON.stringify({ t: 'pong' } satisfies ServerMsg));
    const att = ws.deserializeAttachment() as Attachment | null;
    const id = att?.id ?? ('id' in msg ? msg.id : undefined);
    if (!id) return;
    if (msg.t === 'join') ws.serializeAttachment({ id } satisfies Attachment);

    // Only the host may change the deck or the game's shape. Players may only act as themselves.
    const isHost = id === this.game.hostId || !this.game.hostId;
    if (msg.t === 'load') {
      if (!isHost) return;
      this.deck = toDeck(msg.set);
      this.game = { ...this.game, setTitle: this.deck.title, total: this.deck.questions.length };
      await this.ctx.storage.put({ deck: this.deck, game: this.game });
      return this.broadcast();
    }
    // Host may act on other players (assign teams, rename, promote) but never buzz or answer for them.
    const personal = msg.t === 'buzz' || msg.t === 'answer' || msg.t === 'bonusAnswer';
    if ('id' in msg && msg.id !== id && (!isHost || personal)) return;
    if (!('id' in msg) && !isHost) return;

    this.game = reduce(this.game, msg, Date.now(), this.deck);
    await this.ctx.storage.put('game', this.game);
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    // Only mark offline if no other socket for this player remains (e.g. reconnect race).
    const others = this.ctx
      .getWebSockets()
      .some((w) => w !== ws && (w.deserializeAttachment() as Attachment | null)?.id === att.id);
    if (others) return;
    this.game = reduce(this.game, { t: 'leave', id: att.id }, Date.now(), this.deck);
    await this.ctx.storage.put('game', this.game);
    this.broadcast();
  }

  webSocketError(ws: WebSocket) {
    return this.webSocketClose(ws);
  }

  private stateFor(id: string | null): ServerMsg {
    return { t: 'state', state: redact(this.game, id !== null && id === this.game.hostId), now: Date.now() };
  }

  private broadcast() {
    const host = JSON.stringify(this.stateFor(this.game.hostId));
    const player = JSON.stringify(this.stateFor(null));
    for (const ws of this.ctx.getWebSockets()) {
      const id = (ws.deserializeAttachment() as Attachment | null)?.id;
      try {
        ws.send(id && id === this.game.hostId ? host : player);
      } catch {
        /* closed socket; webSocketClose will clean up */
      }
    }
  }
}
