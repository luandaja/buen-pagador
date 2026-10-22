import { es } from '../i18n/es';
import type { DetectedBox } from './detect';
import { createId, DEBTOR_EMOJIS, isStarted, pickEmojis, type Face, type State } from './state';

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

export const MAX_PEOPLE = 60;
export const MAX_NAME = 30;

// Without a photo people carry no position.
export function addPeople(faces: Face[], count: number, blocked: string[]): Face[] {
  const room = Math.max(0, Math.min(count, MAX_PEOPLE - faces.length));
  const emojis = pickEmojis(room, faces.map((face) => face.emoji), blocked);
  return [...faces, ...emojis.map((emoji) => ({ id: createId(), x: 0, y: 0, w: 0, h: 0, emoji, paid: false }))];
}

const named = (face: Face, name: string): Face => ({ ...face, name: name.trim().slice(0, MAX_NAME) || undefined });

export const renameFace = (faces: Face[], faceId: string, name: string): Face[] =>
  faces.map((face) => (face.id === faceId ? named(face, name) : face));

// A list fills the names from one person on, adding whoever is missing.
export function fillNames(faces: Face[], start: number, names: string[], blocked: string[]): Face[] {
  const people = addPeople(faces, start + names.length - faces.length, blocked);
  return people.map((face, index) => (index >= start && index < start + names.length ? named(face, names[index - start]) : face));
}

const LIST_MARKER = /^\s*(?:\d+\s*[.)\-:]+|[-–•·*]\s)\s*/;
const NOISE = /[\u2705\u2714\u2611\u2713\uFE0F*_]/gu;

// Lists pasted from the group chat: one name per line, with numbers, bullets, checks or a header around them.
export function parseNames(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const items = lines.length > 1 ? lines : text.split(/[,;]/);
  const listed = items.filter((line) => LIST_MARKER.test(line));
  // In a numbered list, the lines without a number are the title or notes, not people.
  const people = listed.length >= 2 ? listed : items;
  return people
    .map((line) => line.replace(LIST_MARKER, '').replace(NOISE, '').trim().slice(0, MAX_NAME))
    .filter(Boolean)
    .slice(0, MAX_PEOPLE);
}

// The start field takes how many people there are, or the list of their names.
export function peopleFrom(text: string, blocked: string[]): Face[] {
  const count = text.trim();
  if (/^\d+$/.test(count)) return addPeople([], Number(count), blocked);
  return fillNames([], 0, parseNames(text), blocked);
}

export const personName = (face: Face, index: number) => face.name?.trim() || es.faces.person(index + 1);

// Without a photo each person is a disc with their initial, or their number while unnamed.
export const personInitial = (face: Face, index: number) => Array.from(face.name?.trim() ?? '')[0]?.toLocaleUpperCase('es') ?? String(index + 1);

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
  const who = personName(face, index);
  if (mode === 'edit') return es.faces.remove(who);
  return face.paid ? es.faces.paidUndo(who) : es.faces.owesMark(who);
}

export function statusMessage(state: Pick<State, 'image' | 'faces' | 'cost'> & Partial<Pick<State, 'quota'>>, scanning: boolean): string | undefined {
  const pendingSteps: [boolean, string][] = [
    [!isStarted(state), es.status.uploadFirst],
    [scanning, es.status.counting],
    [state.faces.length === 0, es.status.addPlayers],
    [!state.cost && !state.quota, es.status.setCost],
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
