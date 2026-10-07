import type { ShareLink } from './share';

export interface Face {
  id: string;
  /** Caja normalizada 0–1 respecto a la foto (cuadrada en píxeles). */
  x: number;
  y: number;
  w: number;
  h: number;
  emoji: string;
  paid: boolean;
}

/** Un partido: foto, caras y pagos. Se guarda en IndexedDB (ver games.ts). */
export interface Game {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  cost: number | null;
  currency: string;
  rounding: number;
  faces: Face[];
  /** Link compartido activo (con su clave y token de edición). */
  share: ShareLink | null;
  /** Foto como data: URL. */
  image: string | null;
  /** Miniatura para el historial. */
  thumb: string | null;
}

/** Preferencias de este dispositivo (localStorage). */
export interface Prefs {
  includePhoto: boolean;
  /** Emojis que el usuario no quiere volver a ver. */
  blocked: string[];
  currentGameId: string | null;
}

/** Lo que tiene abierto el editor: el partido actual y las preferencias. */
export type State = Game & Omit<Prefs, 'currentGameId'>;

export interface Totals {
  people: number;
  paid: number;
  share: number | null;
  collected: number | null;
  missing: number | null;
  pct: number;
}

export const DEBTOR_EMOJIS = [
  '🙈', '🐔', '🦨', '🥸', '🤠', '🐸', '🙉', '🫠', '🤥', '👻',
  '🐒', '🦆', '🤑', '🦃', '🐌', '🐙', '😎', '🤓', '🦊', '🐼',
];

const PREFS_KEY = 'buen-pagador:prefs';
/** Versión anterior: un solo partido guardado en localStorage. */
const LEGACY_KEY = 'buen-pagador:v1';

type GameBase = Partial<Pick<Game, 'title' | 'cost' | 'currency' | 'rounding'>>;

export function newGame(base: GameBase = {}): Game {
  const now = Date.now();
  return {
    id: uid(),
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
    ...base,
  };
}

export const defaultPrefs = (): Prefs => ({ includePhoto: true, blocked: [], currentGameId: null });

export function defaultState(): State {
  const { currentGameId: _, ...prefs } = defaultPrefs();
  return { ...newGame(), ...prefs };
}

function readJson<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* almacenamiento no disponible */
  }
}

export const loadPrefs = (): Prefs => ({ ...defaultPrefs(), ...readJson<Prefs>(PREFS_KEY) });

export const savePrefs = (prefs: Prefs) => writeJson(PREFS_KEY, prefs);

/** Partido y preferencias guardados por la versión anterior, si los hay. Los borra al leerlos. */
export function takeLegacy(): { game: Game | null; prefs: Partial<Prefs> } | null {
  const old = readJson<State>(LEGACY_KEY);
  if (!old) return null;
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
  const prefs = { includePhoto: old.includePhoto ?? true, blocked: old.blocked ?? [] };
  const game = old.image ? { ...newGame(), ...pickGame(old) } : null;
  return { game, prefs };
}

function pickGame(old: Partial<State>): Partial<Game> {
  const { title, cost, currency, rounding, faces, share, image } = old;
  return Object.fromEntries(
    Object.entries({ title, cost, currency, rounding, faces, share, image }).filter(([, v]) => v !== undefined),
  );
}

/** Reemplaza emojis que ya no están permitidos (versión anterior o bloqueados). */
export function refreshEmojis(faces: Face[], blocked: string[]): Face[] {
  const allowed = availableEmojis(blocked);
  const stale = faces.filter((f) => !allowed.includes(f.emoji));
  const fresh = pickEmojis(stale.length, faces.map((f) => f.emoji), blocked);
  return faces.map((f) => (allowed.includes(f.emoji) ? f : { ...f, emoji: fresh.shift()! }));
}

/** Separa el partido de las preferencias. */
export function splitState(state: State): { game: Game; prefs: Prefs } {
  const { includePhoto, blocked, ...game } = state;
  return { game, prefs: { includePhoto, blocked, currentGameId: game.id } };
}

/** Emojis que se pueden usar: la lista sin los bloqueados. */
export function availableEmojis(blocked: string[] = []): string[] {
  const list = DEBTOR_EMOJIS.filter((e) => !blocked.includes(e));
  return list.length ? list : [...DEBTOR_EMOJIS];
}

/** Reparte emojis distintos mientras alcancen, evitando los que se excluyan. */
export function pickEmojis(count: number, avoid: string[] = [], blocked: string[] = []): string[] {
  const allowed = availableEmojis(blocked);
  const out: string[] = [];
  let pool: string[] = [];
  for (let i = 0; i < count; i++) {
    if (pool.length === 0) {
      pool = allowed.filter((e) => !avoid.includes(e));
      if (pool.length === 0) pool = [...allowed];
      shuffle(pool);
    }
    out.push(pool.pop()!);
  }
  return out;
}

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function computeTotals(state: Pick<State, 'faces' | 'cost' | 'rounding'>): Totals {
  const people = state.faces.length;
  const paid = state.faces.filter((f) => f.paid).length;
  const pct = people ? paid / people : 0;
  if (!state.cost || state.cost <= 0 || people === 0) {
    return { people, paid, share: null, collected: null, missing: null, pct };
  }
  const raw = state.cost / people;
  const share = state.rounding > 0 ? Math.ceil(raw / state.rounding - 1e-9) * state.rounding : raw;
  return {
    people,
    paid,
    share,
    collected: share * paid,
    missing: share * (people - paid),
    pct,
  };
}

export function money(value: number | null, currency: string): string {
  if (value == null) return '—';
  const rounded = Math.round(value * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  return currency ? `${currency}\u00a0${text}` : text;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}
