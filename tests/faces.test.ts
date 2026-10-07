import { describe, expect, it } from 'vitest';
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
  it('convierte detecciones en cajas cuadradas centradas', () => {
    const [f] = boxesToFaces([{ x: 0.2, y: 0.3, w: 0.1, h: 0.2, score: 0.9 }], 2, ['🐸']);
    expect(f).toMatchObject({ emoji: '🐸', paid: false, w: 0.1, h: 0.2 });
    expect(f.x).toBeCloseTo(0.2);
    expect(f.y).toBeCloseTo(0.3);
  });
});

describe('operaciones sobre caras', () => {
  const faces = [make('a', '🐸'), make('b', '🐔', true)];

  it('marca y desmarca pagos', () => {
    expect(togglePaid(faces, 'a')[0].paid).toBe(true);
    expect(togglePaid(faces, 'b')[1].paid).toBe(false);
  });

  it('quita una cara', () => {
    expect(removeFace(faces, 'a').map((f) => f.id)).toEqual(['b']);
  });

  it('usa la mediana del tamaño o 0.1 si no hay caras', () => {
    expect(defaultFaceSize([])).toBe(0.1);
    expect(defaultFaceSize([make('a', '🐸', false, 0.05), make('b', '🐸', false, 0.2), make('c', '🐸', false, 0.1)])).toBe(0.1);
  });

  it('agrega una cara centrada en el punto, con emoji no repetido', () => {
    const out = addFaceAt(faces, 0.5, 0.5, 2, []);
    const added = out[2];
    expect(out).toHaveLength(3);
    expect(added.x).toBeCloseTo(0.45);
    expect(added.y).toBeCloseTo(0.4);
    expect(['🐸', '🐔']).not.toContain(added.emoji);
  });

  it('sortea emojis nuevos sin usar los bloqueados', () => {
    const out = rerollEmojis(faces, ['🙈']);
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.emoji)).not.toContain('🙈');
  });
});

describe('blockEmoji', () => {
  it('cambia todas las caras con ese emoji y lo bloquea', () => {
    const faces = [make('a', '🐸'), make('b', '🐸'), make('c', '🐔')];
    const result = blockEmoji({ faces, blocked: [] }, 'a');
    if (!result.ok) throw new Error('debía bloquear');
    expect(result.emoji).toBe('🐸');
    expect(result.blocked).toEqual(['🐸']);
    expect(result.faces.map((f) => f.emoji)).not.toContain('🐸');
    expect(result.faces[2].emoji).toBe('🐔');
  });

  it('no hace nada con caras pagadas o inexistentes', () => {
    const faces = [make('a', '🐸', true)];
    expect(blockEmoji({ faces, blocked: [] }, 'a')).toEqual({ ok: false, reason: 'not-found' });
    expect(blockEmoji({ faces, blocked: [] }, 'zzz')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('se niega si quedarían muy pocos emojis', () => {
    const blocked = DEBTOR_EMOJIS.slice(0, 17);
    const faces = [make('a', DEBTOR_EMOJIS[17])];
    expect(blockEmoji({ faces, blocked }, 'a')).toEqual({ ok: false, reason: 'too-few' });
  });
});

describe('textos', () => {
  it('etiqueta cada cara según el modo', () => {
    expect(faceLabel(make('a', '🐸'), 0, 'edit')).toBe('Quitar persona 1');
    expect(faceLabel(make('a', '🐸', true), 1, 'pay')).toBe('Persona 2: pagó. Tocar para deshacer');
    expect(faceLabel(make('a', '🐸'), 2, 'pay')).toBe('Persona 3: debe. Tocar para marcar como pagado');
  });

  it('muestra el primer paso pendiente', () => {
    const faces = [make('a', '🐸')];
    expect(statusMessage({ image: null, faces, cost: 10 }, false)).toBe('Sube una foto para empezar.');
    expect(statusMessage({ image: 'x', faces, cost: 10 }, true)).toBe('Contando jugadores…');
    expect(statusMessage({ image: 'x', faces: [], cost: 10 }, false)).toMatch(/Agrega/);
    expect(statusMessage({ image: 'x', faces, cost: null }, false)).toMatch(/costo/);
    expect(statusMessage({ image: 'x', faces, cost: 10 }, false)).toBeUndefined();
  });

  it('arma el nombre del archivo desde el título', () => {
    expect(fileName('Jueves 9 pm · Cancha Ñaña')).toBe('buen-pagador-jueves-9-pm-cancha-nana.png');
    expect(fileName('   ')).toBe('buen-pagador-cancha.png');
  });
});
