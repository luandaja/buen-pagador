import type { DetectedBox } from './detect';
import { DEBTOR_EMOJIS, pickEmojis, uid, type Face, type State } from './state';

export type Mode = 'pay' | 'edit';

export const MIN_AVAILABLE = 3;

export function boxesToFaces(boxes: DetectedBox[], aspect: number, emojis: string[]): Face[] {
  return boxes.map((b, i) => {
    const side = Math.max(b.w * aspect, b.h);
    const w = side / aspect;
    const h = side;
    return { id: uid(), x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h, emoji: emojis[i], paid: false };
  });
}

export const togglePaid = (faces: Face[], id: string): Face[] =>
  faces.map((f) => (f.id === id ? { ...f, paid: !f.paid } : f));

export const removeFace = (faces: Face[], id: string): Face[] => faces.filter((f) => f.id !== id);

export function defaultFaceSize(faces: Face[]): number {
  const ws = faces.map((f) => f.w).sort((a, b) => a - b);
  return ws.length ? ws[Math.floor(ws.length / 2)] : 0.1;
}

export function addFaceAt(faces: Face[], cx: number, cy: number, aspect: number, blocked: string[]): Face[] {
  const w = defaultFaceSize(faces);
  const h = w * aspect;
  const [emoji] = pickEmojis(1, faces.map((f) => f.emoji), blocked);
  return [...faces, { id: uid(), x: cx - w / 2, y: cy - h / 2, w, h, emoji, paid: false }];
}

export const rerollEmojis = (faces: Face[], blocked: string[]): Face[] => {
  const emojis = pickEmojis(faces.length, [], blocked);
  return faces.map((f, i) => ({ ...f, emoji: emojis[i] }));
};

export type BlockResult =
  | { ok: true; emoji: string; faces: Face[]; blocked: string[] }
  | { ok: false; reason: 'not-found' | 'too-few' };

export function blockEmoji(state: Pick<State, 'faces' | 'blocked'>, faceId: string): BlockResult {
  const face = state.faces.find((f) => f.id === faceId && !f.paid);
  if (!face) return { ok: false, reason: 'not-found' };
  const emoji = face.emoji;
  const remaining = DEBTOR_EMOJIS.filter((e) => !state.blocked.includes(e) && e !== emoji);
  if (remaining.length < MIN_AVAILABLE) return { ok: false, reason: 'too-few' };

  const blocked = [...state.blocked, emoji];
  const keep = state.faces.filter((f) => f.emoji !== emoji).map((f) => f.emoji);
  const fresh = pickEmojis(state.faces.length - keep.length, keep, blocked);
  const faces = state.faces.map((f) => (f.emoji === emoji ? { ...f, emoji: fresh.shift()! } : f));
  return { ok: true, emoji, faces, blocked };
}

export function faceLabel(face: Face, index: number, mode: Mode): string {
  const who = `Persona ${index + 1}`;
  if (mode === 'edit') return `Quitar ${who.toLowerCase()}`;
  return face.paid ? `${who}: pagó. Tocar para deshacer` : `${who}: debe. Tocar para marcar como pagado`;
}

export function statusMessage(state: Pick<State, 'image' | 'faces' | 'cost'>, scanning: boolean): string | undefined {
  const steps: [boolean, string][] = [
    [!state.image, 'Sube una foto para empezar.'],
    [scanning, 'Contando jugadores…'],
    [state.faces.length === 0, 'Agrega a los jugadores tocando sus caras.'],
    [!state.cost, 'Pon el costo de la cancha para ver la cuota.'],
  ];
  return steps.find(([pending]) => pending)?.[1];
}

export function fileName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `buen-pagador-${slug || 'cancha'}.png`;
}
