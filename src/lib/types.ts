export interface Bonus {
  q: string;
  a: string;
}

export interface Question {
  id?: string;
  tossup: string;
  answer: string;
  bonuses: Bonus[];
  category?: Category | null; // one of the four main categories
  subcategory?: string | null; // finer grain for analytics, e.g. "Subjunctive", "Derivatives"
}

/** The four main certamen categories. Finer distinctions go in `subcategory`. */
export const CATEGORIES = ['Grammar', 'History', 'Mythology', 'Literature'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Region: "National" for NJCL, a US state for state JCL events or school-hosted tournaments,
 * "Competitive Circuit" for open invitationals (typically college-hosted) that belong to neither.
 */
export const REGIONS = [
  'National',
  'Competitive Circuit',
  'Alabama',
  'Alaska',
  'Arizona',
  'Arkansas',
  'California',
  'Colorado',
  'Connecticut',
  'Delaware',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'New York',
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  'Texas',
  'Utah',
  'Vermont',
  'Virginia',
  'Washington',
  'West Virginia',
  'Wisconsin',
  'Wyoming',
  'District of Columbia',
] as const;

export type Level = 'novice' | 'intermediate' | 'advanced';

export interface QuestionSet {
  id?: string;
  owner?: string;
  title: string;
  level?: Level | null;
  year?: number | null;
  tournament?: string | null;
  region?: string | null;
  round?: string | null;
  public: boolean;
  questions: Question[];
  count?: number; // question count when listed without questions
  created_at?: string;
}

/** One recorded tossup buzz, as stored in the `buzzes` table. */
export interface BuzzRow {
  question_id: string;
  room: string;
  mode: Mode;
  player: string;
  team: number;
  word: number;
  words: number;
  correct: boolean;
  answer?: string;
  created_at?: string;
}

export type Mode = 'reader' | 'live';
export type Phase = 'lobby' | 'reading' | 'paused' | 'buzzed' | 'bonus' | 'dead' | 'done';

export interface Player {
  id: string;
  name: string;
  team: number;
  online: boolean;
}

export interface Result {
  qi: number;
  team: number;
  player: string;
  correct: boolean;
  word: number; // words revealed when the buzz landed
  answer?: string; // what the player typed (reader mode)
  bonuses: (boolean | null)[]; // one per bonus; null = not yet judged
}

export interface Buzz {
  player: string;
  team: number;
  at: number; // server ms
  word: number; // words revealed when buzz arrived
}

export interface Game {
  code: string;
  mode: Mode;
  hostId: string | null;
  teams: string[];
  players: Record<string, Player>;
  setTitle: string;
  total: number; // number of questions in the loaded set
  qi: number; // current question index
  phase: Phase;
  startedAt: number; // reader mode: reveal start (ms), adjusted on resume
  wpm: number;
  buzz: Buzz | null;
  locked: number[]; // teams locked out of the current tossup
  pausedWord: number; // words revealed when the host paused (reader mode)
  results: Result[];
  bonusIdx: number; // which bonus is being played
  question: Question | null; // current question, answers redacted for non-hosts until revealed
  revealed: boolean; // answers visible to everyone
  log: string[];
}

export type Event =
  | { t: 'join'; id: string; name: string; team?: number }
  | { t: 'leave'; id: string }
  | { t: 'team'; id: string; team: number }
  | { t: 'rename'; id: string; name: string }
  | { t: 'host'; id: string }
  | { t: 'config'; mode?: Mode; wpm?: number; teams?: string[] }
  | { t: 'start' }
  | { t: 'buzz'; id: string }
  | { t: 'answer'; id: string; text: string }
  | { t: 'judge'; correct: boolean } // host ruling on the current tossup buzz (or override)
  | { t: 'bonus'; correct: boolean } // host ruling on the current bonus
  | { t: 'bonusAnswer'; id: string; text: string } // reader mode: team types a bonus answer
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'dead' } // nobody answered; move on
  | { t: 'next' }
  | { t: 'goto'; qi: number }
  | { t: 'reset' };

/** Client → server messages that are not game events. */
export type ClientMsg = Event | { t: 'load'; set: QuestionSet } | { t: 'ping' };
export type ServerMsg =
  { t: 'state'; state: Game; now: number } | { t: 'error'; msg: string } | { t: 'pong' };
