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

export interface State {
  image: string | null;
  faces: Face[];
  cost: number | null;
  currency: string;
  title: string;
  rounding: number;
  includePhoto: boolean;
  /** Emojis que el usuario no quiere volver a ver. */
  blocked: string[];
  /** Link compartido activo (con su clave y token de edición). */
  share: ShareLink | null;
}

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

const STORAGE_KEY = 'buen-pagador:v1';

export function defaultState(): State {
  return {
    image: null,
    faces: [],
    cost: null,
    currency: 'S/',
    title: '',
    rounding: 0,
    includePhoto: true,
    blocked: [],
    share: null,
  };
}

export function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved: State = { ...defaultState(), ...JSON.parse(raw) };
      // Reemplaza emojis que ya no están permitidos (versión anterior o bloqueados).
      const allowed = availableEmojis(saved.blocked);
      const stale = saved.faces.filter((f) => !allowed.includes(f.emoji));
      const fresh = pickEmojis(stale.length, saved.faces.map((f) => f.emoji), saved.blocked);
      saved.faces = saved.faces.map((f) => (allowed.includes(f.emoji) ? f : { ...f, emoji: fresh.shift()! }));
      return saved;
    }
  } catch {
    /* almacenamiento no disponible */
  }
  return defaultState();
}

export function saveState(state: State): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Si la foto no cabe, guardamos al menos los datos.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, image: null, faces: [] }));
    } catch {
      /* nada que hacer */
    }
  }
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
