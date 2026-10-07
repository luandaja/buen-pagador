import type { ShareLink } from './share';

export interface Face {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  emoji: string;
  paid: boolean;
}

export interface Game {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  cost: number | null;
  currency: string;
  rounding: number;
  faces: Face[];
  share: ShareLink | null;
  image: string | null;
  thumb: string | null;
  payNote: string;
  payQr: string | null;
}

export interface Prefs {
  includePhoto: boolean;
  blocked: string[];
  currentGameId: string | null;
}

export type State = Game & Omit<Prefs, 'currentGameId'>;

export interface Totals {
  people: number;
  paid: number;
  share: number | null;
  collected: number | null;
  missing: number | null;
  paidRatio: number;
}

export const DEBTOR_EMOJIS = [
  '🙈', '🐔', '🦨', '🥸', '🤠', '🐸', '🙉', '🫠', '🤥', '👻',
  '🐒', '🦆', '🤑', '🦃', '🐌', '🐙', '😎', '🤓', '🦊', '🐼',
];

const PREFS_KEY = 'buen-pagador:prefs';
const LEGACY_KEY = 'buen-pagador:v1';

type GameBase = Partial<Pick<Game, 'title' | 'cost' | 'currency' | 'rounding' | 'payNote' | 'payQr'>>;

export function newGame(base: GameBase = {}): Game {
  const now = Date.now();
  return {
    id: createId(),
    createdAt: now,
    updatedAt: now,
    title: '',
    cost: null,
    currency: 'S/',
    rounding: 0,
    faces: [],
    share: null,
    image: null,
    thumb: null,
    payNote: '',
    payQr: null,
    ...base,
  };
}

export const defaultPrefs = (): Prefs => ({ includePhoto: true, blocked: [], currentGameId: null });

export function defaultState(): State {
  const { includePhoto, blocked } = defaultPrefs();
  return { ...newGame(), includePhoto, blocked };
}

function attempt<T>(action: () => T, fallback: T): T {
  try {
    return action();
  } catch {
    return fallback;
  }
}

function readJson<T>(key: string): Partial<T> | null {
  return attempt(() => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  }, null);
}

function writeJson(key: string, value: unknown) {
  attempt(() => localStorage.setItem(key, JSON.stringify(value)), undefined);
}

export const loadPrefs = (): Prefs => ({ ...defaultPrefs(), ...readJson<Prefs>(PREFS_KEY) });

export const savePrefs = (prefs: Prefs) => writeJson(PREFS_KEY, prefs);

export function takeLegacy(): { game: Game | null; prefs: Partial<Prefs> } | null {
  const legacyState = readJson<State>(LEGACY_KEY);
  if (!legacyState) return null;
  attempt(() => localStorage.removeItem(LEGACY_KEY), undefined);
  const prefs = { includePhoto: legacyState.includePhoto ?? true, blocked: legacyState.blocked ?? [] };
  const game = legacyState.image ? { ...newGame(), ...legacyGameFields(legacyState) } : null;
  return { game, prefs };
}

function legacyGameFields(legacyState: Partial<State>): Partial<Game> {
  const { title, cost, currency, rounding, faces, share, image } = legacyState;
  const fields = { title, cost, currency, rounding, faces, share, image };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

export function refreshEmojis(faces: Face[], blocked: string[]): Face[] {
  const allowed = availableEmojis(blocked);
  const staleFaces = faces.filter((face) => !allowed.includes(face.emoji));
  const replacements = pickEmojis(staleFaces.length, faces.map((face) => face.emoji), blocked);
  return faces.map((face) => (allowed.includes(face.emoji) ? face : { ...face, emoji: replacements.shift()! }));
}

export function splitState(state: State): { game: Game; prefs: Prefs } {
  const { includePhoto, blocked, ...game } = state;
  return { game, prefs: { includePhoto, blocked, currentGameId: game.id } };
}

export function availableEmojis(blocked: string[] = []): string[] {
  const allowed = DEBTOR_EMOJIS.filter((emoji) => !blocked.includes(emoji));
  return allowed.length ? allowed : [...DEBTOR_EMOJIS];
}

export function pickEmojis(count: number, avoid: string[] = [], blocked: string[] = []): string[] {
  const allowed = availableEmojis(blocked);
  const picked: string[] = [];
  let pool: string[] = [];
  while (picked.length < count) {
    if (pool.length === 0) pool = shuffled(freshPool(allowed, avoid));
    picked.push(pool.pop()!);
  }
  return picked;
}

function freshPool(allowed: string[], avoid: string[]): string[] {
  const unused = allowed.filter((emoji) => !avoid.includes(emoji));
  return unused.length ? unused : [...allowed];
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}

export function computeTotals(state: Pick<State, 'faces' | 'cost' | 'rounding'>): Totals {
  const people = state.faces.length;
  const paid = state.faces.filter((face) => face.paid).length;
  const paidRatio = people ? paid / people : 0;
  if (!state.cost || state.cost <= 0 || people === 0) {
    return { people, paid, share: null, collected: null, missing: null, paidRatio };
  }
  const share = roundUp(state.cost / people, state.rounding);
  return { people, paid, share, collected: share * paid, missing: share * (people - paid), paidRatio };
}

const ROUNDING_TOLERANCE = 1e-9;

function roundUp(amount: number, step: number): number {
  return step > 0 ? Math.ceil(amount / step - ROUNDING_TOLERANCE) * step : amount;
}

export function money(value: number | null, currency: string): string {
  if (value == null) return '—';
  const rounded = Math.round(value * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  return currency ? `${currency}\u00a0${text}` : text;
}

export function createId(): string {
  return Math.random().toString(36).slice(2, 10);
}
