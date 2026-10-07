import { es } from '../i18n/es';
import type { DetectedBox } from './detect';
import { createId, DEBTOR_EMOJIS, pickEmojis, type Face, type State } from './state';

export type Mode = 'pay' | 'edit';

export const MIN_AVAILABLE = 3;
const FALLBACK_FACE_SIZE = 0.1;

export function boxesToFaces(boxes: DetectedBox[], aspectRatio: number, emojis: string[]): Face[] {
  return boxes.map((box, index) => {
    const sideInHeightUnits = Math.max(box.w * aspectRatio, box.h);
    const width = sideInHeightUnits / aspectRatio;
    const height = sideInHeightUnits;
    const centerX = box.x + box.w / 2;
    const centerY = box.y + box.h / 2;
    return {
      id: createId(),
      x: centerX - width / 2,
      y: centerY - height / 2,
      w: width,
      h: height,
      emoji: emojis[index],
      paid: false,
    };
  });
}

export const togglePaid = (faces: Face[], faceId: string): Face[] =>
  faces.map((face) => (face.id === faceId ? { ...face, paid: !face.paid } : face));

export const removeFace = (faces: Face[], faceId: string): Face[] => faces.filter((face) => face.id !== faceId);

export function defaultFaceSize(faces: Face[]): number {
  const widths = faces.map((face) => face.w).sort((first, second) => first - second);
  return widths.length ? widths[Math.floor(widths.length / 2)] : FALLBACK_FACE_SIZE;
}

export function addFaceAt(faces: Face[], centerX: number, centerY: number, aspectRatio: number, blocked: string[]): Face[] {
  const width = defaultFaceSize(faces);
  const height = width * aspectRatio;
  const [emoji] = pickEmojis(1, faces.map((face) => face.emoji), blocked);
  const newFace = { id: createId(), x: centerX - width / 2, y: centerY - height / 2, w: width, h: height, emoji, paid: false };
  return [...faces, newFace];
}

export const rerollEmojis = (faces: Face[], blocked: string[]): Face[] => {
  const emojis = pickEmojis(faces.length, [], blocked);
  return faces.map((face, index) => ({ ...face, emoji: emojis[index] }));
};

export type BlockResult =
  | { ok: true; emoji: string; faces: Face[]; blocked: string[] }
  | { ok: false; reason: 'not-found' | 'too-few' };

export function blockEmoji(state: Pick<State, 'faces' | 'blocked'>, faceId: string): BlockResult {
  const target = state.faces.find((face) => face.id === faceId && !face.paid);
  if (!target) return { ok: false, reason: 'not-found' };
  const emoji = target.emoji;
  const stillAvailable = DEBTOR_EMOJIS.filter((candidate) => !state.blocked.includes(candidate) && candidate !== emoji);
  if (stillAvailable.length < MIN_AVAILABLE) return { ok: false, reason: 'too-few' };

  const blocked = [...state.blocked, emoji];
  const keptEmojis = state.faces.filter((face) => face.emoji !== emoji).map((face) => face.emoji);
  const replacements = pickEmojis(state.faces.length - keptEmojis.length, keptEmojis, blocked);
  const faces = state.faces.map((face) => (face.emoji === emoji ? { ...face, emoji: replacements.shift()! } : face));
  return { ok: true, emoji, faces, blocked };
}

export function faceLabel(face: Face, index: number, mode: Mode): string {
  const position = index + 1;
  if (mode === 'edit') return es.faces.remove(position);
  return face.paid ? es.faces.paidUndo(position) : es.faces.owesMark(position);
}

export function statusMessage(state: Pick<State, 'image' | 'faces' | 'cost'>, scanning: boolean): string | undefined {
  const pendingSteps: [boolean, string][] = [
    [!state.image, es.status.uploadFirst],
    [scanning, es.status.counting],
    [state.faces.length === 0, es.status.addPlayers],
    [!state.cost, es.status.setCost],
  ];
  return pendingSteps.find(([isPending]) => isPending)?.[1];
}

export function fileName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return es.image.fileName(slug);
}
