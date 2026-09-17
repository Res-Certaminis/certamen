/** Tiny reconnecting WebSocket client for a game room. */
import type { ClientMsg, Game, ServerMsg } from './types';

export function connect(
  code: string,
  onState: (g: Game, serverNow: number) => void,
  onStatus: (s: string) => void,
) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws/${code}`;
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = 500;
  const queue: ClientMsg[] = [];
  let onOpen: (() => void) | null = null;

  const open = () => {
    onStatus('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => {
      backoff = 500;
      onStatus('online');
      onOpen?.();
      for (const m of queue.splice(0)) ws!.send(JSON.stringify(m));
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data) as ServerMsg;
      if (m.t === 'state') onState(m.state, m.now);
      else if (m.t === 'error') onStatus(m.msg);
    };
    ws.onclose = () => {
      ws = null;
      if (closed) return;
      onStatus('offline');
      setTimeout(open, (backoff = Math.min(backoff * 2, 8000)));
    };
  };
  open();
  // Keep the socket warm through proxies; Durable Object hibernation makes this nearly free.
  const ping = setInterval(() => ws?.readyState === 1 && ws.send('{"t":"ping"}'), 30000);

  return {
    send(m: ClientMsg) {
      if (ws?.readyState === 1) ws.send(JSON.stringify(m));
      else queue.push(m);
    },
    /** Run on every (re)connect, e.g. to re-join. */
    onOpen(fn: () => void) {
      onOpen = fn;
      if (ws?.readyState === 1) fn();
    },
    close() {
      closed = true;
      clearInterval(ping);
      ws?.close();
    },
  };
}
