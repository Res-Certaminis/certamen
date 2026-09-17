/**
 * Optional AI-assisted packet parsing with the uploader's own Anthropic key.
 * Runs entirely in the browser; the key is stored in localStorage on this device only.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { CATEGORIES, type Level, type QuestionSet } from './types';

export const AI_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 (most accurate)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (cheapest)' },
] as const;
export type AiModel = (typeof AI_MODELS)[number]['id'];

const Parsed = z.object({
  title: z.string().nullable(),
  level: z.enum(['novice', 'intermediate', 'advanced']).nullable(),
  year: z.number().int().nullable(),
  tournament: z.string().nullable(),
  region: z.string().nullable(),
  round: z.string().nullable(),
  questions: z.array(
    z.object({
      tossup: z.string(),
      answer: z.string(),
      category: z.enum(CATEGORIES).nullable(),
      subcategory: z.string().nullable(),
      bonuses: z.array(z.object({ q: z.string(), a: z.string() })),
    }),
  ),
});
export type ParsedPacket = z.infer<typeof Parsed>;

const SYSTEM = `You convert certamen (Latin quiz bowl) packets into structured data.

A packet is a numbered list of tossups. Each tossup has exactly one answer line and is usually followed by one to three bonus questions (B1, B2, B3), each with its own answer. Answer lines may include alternates such as "(accept ...)", "(prompt on ...)" or "(do not accept ...)": keep them verbatim as part of the answer string. Preserve the original question wording, including Latin macrons; only fix line-wrap artefacts and stray hyphenation. Ignore page headers, footers, page numbers and moderator instructions that are not part of a question. Keep tossups in packet order and do not invent or drop questions.

Categories. Every tossup gets exactly one main category: Grammar, History, Mythology or Literature. Grammar covers language questions of every kind: forms, syntax, vocabulary, derivatives, translation, mottoes and abbreviations. History covers Roman history, culture, daily life and geography. Also give a short subcategory (one to three words) when it is clear, for example Grammar → "Subjunctive", "Vocabulary", "Derivatives", "Translation", "Mottoes"; History → "Republic", "Second Punic War", "Daily Life", "Geography"; Mythology → "Trojan War", "Metamorphoses", "Underworld"; Literature → "Vergil", "Golden Age", "Meter". Use null for the subcategory when unsure; never use null for the main category unless the question truly fits none.

Set metadata, only when the packet states it; otherwise null. level: novice, intermediate or advanced. year: four digits. tournament: the organising body or event, e.g. "NJCL", "Virginia JCL", "Yale Certamen Invitational". round: e.g. "Round 3", "Semifinal". region follows these rules: "National" for NJCL; the US state name for a state JCL convention/forum or a tournament hosted by a specific high school in that state; "Competitive Circuit" for open invitationals that belong to neither, which are typically hosted by colleges or universities.`;

export interface ParseResult extends ParsedPacket {
  usage: { input: number; output: number };
}

/** `context` is front matter (cover page) that carries tournament/level/year for every round. */
export async function aiParse(
  text: string,
  apiKey: string,
  model: AiModel,
  context = '',
  onProgress?: (questionsSoFar: number) => void,
): Promise<ParseResult> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const stream = client.messages.stream({
    model,
    max_tokens: 32000,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          (context ? `Packet front matter:\n\n${context.slice(0, 3000)}\n\n` : '') + `Round text:\n\n${text}`,
      },
    ],
    output_config: { format: zodOutputFormat(Parsed) },
  });
  // Structured output arrives as one JSON text block; count completed tossups as it streams.
  if (onProgress) stream.on('text', (_delta, snapshot) => onProgress(countQuestions(snapshot)));
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'max_tokens')
    throw new Error('The packet is too long for one pass; split it and try again.');
  if (msg.stop_reason === 'refusal') throw new Error('The model declined to process this text.');
  if (!msg.parsed_output) throw new Error('The model returned no structured result.');
  return { ...msg.parsed_output, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens } };
}

/** Number of tossup objects whose "answer" key has appeared in a partial JSON snapshot. */
export const countQuestions = (partialJson: string) => (partialJson.match(/"answer"\s*:/g) ?? []).length;

/** Merge an AI parse into a set draft, keeping any metadata the uploader already typed. */
export function applyParsed(p: ParsedPacket, base: Partial<QuestionSet> = {}): QuestionSet {
  return {
    public: true,
    ...base,
    title: base.title || p.title || '',
    level: (base.level ?? p.level ?? null) as Level | null,
    year: base.year ?? p.year ?? null,
    tournament: base.tournament ?? p.tournament ?? null,
    region: base.region ?? p.region ?? null,
    round: base.round ?? p.round ?? null,
    questions: p.questions.map((q) => ({ ...q, bonuses: q.bonuses.slice(0, 3) })),
  };
}

/** Human-readable error for the upload UI. */
export function aiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'Anthropic rejected the API key.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by Anthropic; try again in a minute.';
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status}: ${e.message}`;
  return (e as Error).message ?? String(e);
}
