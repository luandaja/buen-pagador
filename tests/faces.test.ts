import { describe, expect, it } from 'vitest';
import { es } from '../src/i18n/es';
import {
  addFaceAt,
  blockEmoji,
  boxesToFaces,
  defaultFaceSize,
  faceLabel,
  fileName,
  removeFace,
  rerollEmojis,
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

describe('labels', () => {
  it('labels each face by mode', () => {
    expect(faceLabel(make('a', '🐸'), 0, 'edit')).toBe(es.faces.remove(1));
    expect(faceLabel(make('a', '🐸', true), 1, 'pay')).toBe(es.faces.paidUndo(2));
    expect(faceLabel(make('a', '🐸'), 2, 'pay')).toBe(es.faces.owesMark(3));
  });

  it('shows the first pending step', () => {
    const faces = [make('a', '🐸')];
    expect(statusMessage({ image: null, faces, cost: 10 }, false)).toBe(es.status.uploadFirst);
    expect(statusMessage({ image: 'x', faces, cost: 10 }, true)).toBe(es.status.counting);
    expect(statusMessage({ image: 'x', faces: [], cost: 10 }, false)).toBe(es.status.addPlayers);
    expect(statusMessage({ image: 'x', faces, cost: null }, false)).toBe(es.status.setCost);
    expect(statusMessage({ image: 'x', faces, cost: 10 }, false)).toBeUndefined();
  });

  it('builds the file name from the title', () => {
    expect(fileName('Thursday 9 pm · Crème Brûlée')).toBe(es.image.fileName('thursday-9-pm-creme-brulee'));
    expect(fileName('   ')).toBe(es.image.fileName(''));
  });
});
