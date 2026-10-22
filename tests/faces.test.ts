import { describe, expect, it } from 'vitest';
import { es } from '../src/i18n/es';
import {
  addFaceAt,
  addPeople,
  blockEmoji,
  boxesToFaces,
  defaultFaceSize,
  faceLabel,
  fileName,
  fillNames,
  removeFace,
  rerollEmojis,
  MAX_NAME,
  MAX_PEOPLE,
  parseNames,
  peopleFrom,
  personInitial,
  personName,
  renameFace,
  statusMessage,
  togglePaid,
} from '../src/scripts/faces';
import { DEBTOR_EMOJIS, type Face } from '../src/scripts/state';

const make = (id: string, emoji: string, paid = false, w = 0.1): Face => ({ id, x: 0.1, y: 0.1, w, h: w, emoji, paid });

describe('boxesToFaces', () => {
  it('turns detections into centered square boxes', () => {
    const [detectedFace] = boxesToFaces([{ x: 0.2, y: 0.3, w: 0.1, h: 0.2, score: 0.9 }], 2, ['🐸']);
    expect(detectedFace).toMatchObject({ emoji: '🐸', paid: false, w: 0.1, h: 0.2 });
    expect(detectedFace.x).toBeCloseTo(0.2);
    expect(detectedFace.y).toBeCloseTo(0.3);
  });
});

describe('face operations', () => {
  const faces = [make('a', '🐸'), make('b', '🐔', true)];

  it('marks and unmarks payments', () => {
    expect(togglePaid(faces, 'a')[0].paid).toBe(true);
    expect(togglePaid(faces, 'b')[1].paid).toBe(false);
  });

  it('removes a face', () => {
    expect(removeFace(faces, 'a').map((face) => face.id)).toEqual(['b']);
  });

  it('uses the median size, or 0.1 without faces', () => {
    expect(defaultFaceSize([])).toBe(0.1);
    expect(defaultFaceSize([make('a', '🐸', false, 0.05), make('b', '🐸', false, 0.2), make('c', '🐸', false, 0.1)])).toBe(0.1);
  });

  it('adds a face centered on the point with an unused emoji', () => {
    const out = addFaceAt(faces, 0.5, 0.5, 2, []);
    const added = out[2];
    expect(out).toHaveLength(3);
    expect(added.x).toBeCloseTo(0.45);
    expect(added.y).toBeCloseTo(0.4);
    expect(['🐸', '🐔']).not.toContain(added.emoji);
  });

  it('rerolls emojis without blocked ones', () => {
    const out = rerollEmojis(faces, ['🙈']);
    expect(out).toHaveLength(2);
    expect(out.map((face) => face.emoji)).not.toContain('🙈');
  });
});

describe('blockEmoji', () => {
  it('replaces every face with that emoji and blocks it', () => {
    const faces = [make('a', '🐸'), make('b', '🐸'), make('c', '🐔')];
    const result = blockEmoji({ faces, blocked: [] }, 'a');
    if (!result.ok) throw new Error('expected a block');
    expect(result.emoji).toBe('🐸');
    expect(result.blocked).toEqual(['🐸']);
    expect(result.faces.map((face) => face.emoji)).not.toContain('🐸');
    expect(result.faces[2].emoji).toBe('🐔');
  });

  it('ignores paid or missing faces', () => {
    const faces = [make('a', '🐸', true)];
    expect(blockEmoji({ faces, blocked: [] }, 'a')).toEqual({ ok: false, reason: 'not-found' });
    expect(blockEmoji({ faces, blocked: [] }, 'zzz')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('refuses when too few emojis would remain', () => {
    const blocked = DEBTOR_EMOJIS.slice(0, 17);
    const faces = [make('a', DEBTOR_EMOJIS[17])];
    expect(blockEmoji({ faces, blocked }, 'a')).toEqual({ ok: false, reason: 'too-few' });
  });
});

describe('people without photo', () => {
  it('adds unplaced people with fresh emojis, up to the maximum', () => {
    const faces = addPeople([make('a', '🐸')], 2, ['🐔']);
    expect(faces).toHaveLength(3);
    expect(faces[0].id).toBe('a');
    expect(faces[1]).toMatchObject({ x: 0, y: 0, w: 0, h: 0, paid: false });
    expect(faces.map((face) => face.emoji)).not.toContain('🐔');
    expect(new Set(faces.map((face) => face.emoji)).size).toBe(3);
    expect(addPeople([], MAX_PEOPLE + 10, [])).toHaveLength(MAX_PEOPLE);
    expect(addPeople(faces, -1, [])).toHaveLength(3);
  });

  it('renames someone, trimming and clearing empty names', () => {
    const faces = [make('a', '🐸', true), make('b', '🦊')];
    expect(renameFace(faces, 'a', '  Juan  ')[0]).toMatchObject({ name: 'Juan', paid: true });
    expect(renameFace(faces, 'a', 'x'.repeat(MAX_NAME + 5))[0].name).toHaveLength(MAX_NAME);
    expect(renameFace(renameFace(faces, 'a', 'Juan'), 'a', '  ')[0].name).toBeUndefined();
    expect(renameFace(faces, 'a', 'Juan')[1]).toBe(faces[1]);
  });

  it('fills names from one person on and adds whoever is missing', () => {
    const faces = fillNames([make('a', '🐸', true), make('b', '🦊')], 1, ['Pedro', 'Luis', 'Ana'], []);
    expect(faces.map((face) => face.name)).toEqual([undefined, 'Pedro', 'Luis', 'Ana']);
    expect(faces[0].paid).toBe(true);
  });

  it('names people the way they are named', () => {
    expect(personName(make('a', '🐸'), 2)).toBe(es.faces.person(3));
    expect(personName({ ...make('a', '🐸'), name: 'Juan' }, 2)).toBe('Juan');
  });

  it('gives each person an initial, or their number while unnamed', () => {
    expect(personInitial({ ...make('a', '🐸'), name: ' ñato' }, 0)).toBe('Ñ');
    expect(personInitial({ ...make('a', '🐸'), name: '🦊 Zorro' }, 0)).toBe('🦊');
    expect(personInitial(make('a', '🐸'), 2)).toBe('3');
  });
});

describe('parseNames', () => {
  it('reads a numbered list from the group chat, without its title, checks or bold', () => {
    const list = 'Jueves 9 pm 🏀\n1. Juan\n2) *Pedro* ✅\n3.Luis ✔️\n4 - Ana\n5.\nTraigan pelota';
    expect(parseNames(list)).toEqual(['Juan', 'Pedro', 'Luis', 'Ana']);
  });

  it('reads plain lines, bullets and names separated by commas', () => {
    expect(parseNames('Juan\n\n  Pedro Pérez \n')).toEqual(['Juan', 'Pedro Pérez']);
    expect(parseNames('- Juan\n• Pedro')).toEqual(['Juan', 'Pedro']);
    expect(parseNames('Juan, Pedro; Luis')).toEqual(['Juan', 'Pedro', 'Luis']);
    expect(parseNames('Juan')).toEqual(['Juan']);
    expect(parseNames('   ')).toEqual([]);
  });

  it('caps how many and how long', () => {
    const many = Array.from({ length: MAX_PEOPLE + 5 }, (_, index) => `Persona ${index}`).join('\n');
    expect(parseNames(many)).toHaveLength(MAX_PEOPLE);
    expect(parseNames('x'.repeat(50))[0]).toHaveLength(MAX_NAME);
  });

  it('the start field takes a count or a list', () => {
    expect(peopleFrom(' 4 ', [])).toHaveLength(4);
    expect(peopleFrom('0', [])).toEqual([]);
    expect(peopleFrom('1. Juan\n2. Pedro', []).map((face) => face.name)).toEqual(['Juan', 'Pedro']);
    expect(peopleFrom('', [])).toEqual([]);
  });
});

describe('labels', () => {
  it('labels each face by mode', () => {
    expect(faceLabel(make('a', '🐸'), 0, 'edit')).toBe(es.faces.remove(es.faces.person(1)));
    expect(faceLabel(make('a', '🐸', true), 1, 'pay')).toBe(es.faces.paidUndo(es.faces.person(2)));
    expect(faceLabel({ ...make('a', '🐸'), name: 'Juan' }, 2, 'pay')).toBe(es.faces.owesMark('Juan'));
  });

  it('shows the first pending step', () => {
    const faces = [make('a', '🐸')];
    expect(statusMessage({ image: null, faces: [], cost: 10 }, false)).toBe(es.status.uploadFirst);
    expect(statusMessage({ image: 'x', faces, cost: 10 }, true)).toBe(es.status.counting);
    expect(statusMessage({ image: 'x', faces: [], cost: 10 }, false)).toBe(es.status.addPlayers);
    expect(statusMessage({ image: 'x', faces, cost: null }, false)).toBe(es.status.setCost);
    expect(statusMessage({ image: 'x', faces, cost: 10 }, false)).toBeUndefined();
  });

  it('a game without photo starts with its people, and a per-person quota is enough', () => {
    const faces = [make('a', '🐸')];
    expect(statusMessage({ image: null, faces, cost: null }, false)).toBe(es.status.setCost);
    expect(statusMessage({ image: null, faces, cost: null, quota: 10 }, false)).toBeUndefined();
  });

  it('builds the file name from the title', () => {
    expect(fileName('Thursday 9 pm · Crème Brûlée')).toBe(es.image.fileName('thursday-9-pm-creme-brulee'));
    expect(fileName('   ')).toBe(es.image.fileName(''));
  });
});
