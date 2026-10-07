import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  availableEmojis,
  computeTotals,
  DEBTOR_EMOJIS,
  defaultPrefs,
  defaultState,
  loadPrefs,
  money,
  newGame,
  pickEmojis,
  refreshEmojis,
  savePrefs,
  splitState,
  takeLegacy,
  uid,
  type Face,
} from '../src/scripts/state';

const face = (paid: boolean, emoji = '🐸'): Face => ({ id: uid(), x: 0, y: 0, w: 0.1, h: 0.1, emoji, paid });

describe('computeTotals', () => {
  it('sin costo ni jugadores no hay cuota', () => {
    expect(computeTotals({ faces: [], cost: null, rounding: 0 })).toEqual({
      people: 0,
      paid: 0,
      share: null,
      collected: null,
      missing: null,
      pct: 0,
    });
  });

  it('reparte el costo y suma lo recaudado', () => {
    const t = computeTotals({ faces: [face(true), face(false), face(false), face(true)], cost: 100, rounding: 0 });
    expect(t).toMatchObject({ people: 4, paid: 2, share: 25, collected: 50, missing: 50, pct: 0.5 });
  });

  it('redondea la cuota hacia arriba', () => {
    const faces = [face(false), face(false), face(false)];
    expect(computeTotals({ faces, cost: 100, rounding: 0.5 }).share).toBe(33.5);
    expect(computeTotals({ faces, cost: 100, rounding: 1 }).share).toBe(34);
    expect(computeTotals({ faces, cost: 90, rounding: 1 }).share).toBe(30);
  });

  it('con costo cero no calcula montos', () => {
    expect(computeTotals({ faces: [face(true)], cost: 0, rounding: 0 }).share).toBeNull();
  });
});

describe('money', () => {
  it('formatea con moneda y espacio que no se corta', () => {
    expect(money(12, 'S/')).toBe('S/ 12');
    expect(money(4.825, 'S/')).toBe('S/ 4.83');
    expect(money(7, '')).toBe('7');
    expect(money(null, 'S/')).toBe('—');
  });
});

describe('emojis', () => {
  it('no repite mientras alcanzan y evita los indicados', () => {
    const picked = pickEmojis(5, ['🐸']);
    expect(new Set(picked).size).toBe(5);
    expect(picked).not.toContain('🐸');
  });

  it('respeta los bloqueados y vuelve a empezar cuando se acaban', () => {
    const blocked = DEBTOR_EMOJIS.slice(0, 18);
    const picked = pickEmojis(5, [], blocked);
    expect(picked.every((e) => !blocked.includes(e))).toBe(true);
  });

  it('si se evita todo, usa igual los permitidos', () => {
    const allowed = availableEmojis([]);
    expect(pickEmojis(2, allowed)).toHaveLength(2);
  });

  it('si todo está bloqueado, usa la lista completa', () => {
    expect(availableEmojis([...DEBTOR_EMOJIS])).toEqual(DEBTOR_EMOJIS);
  });
});

describe('partidos y preferencias', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('newGame crea un partido vacío con id y fechas, aceptando datos base', () => {
    const game = newGame({ title: 'Jueves', cost: 90 });
    expect(game).toMatchObject({ title: 'Jueves', cost: 90, currency: 'S/', faces: [], image: null, share: null });
    expect(game.id).toMatch(/^\w+$/);
    expect(game.createdAt).toBe(game.updatedAt);
  });

  it('defaultState junta un partido nuevo con las preferencias por defecto', () => {
    expect(defaultState()).toMatchObject({ includePhoto: true, blocked: [] });
    expect(defaultState()).not.toHaveProperty('currentGameId');
  });

  it('guarda y lee las preferencias', () => {
    expect(loadPrefs()).toEqual(defaultPrefs());
    savePrefs({ includePhoto: false, blocked: ['🐔'], currentGameId: 'abc' });
    expect(loadPrefs()).toEqual({ includePhoto: false, blocked: ['🐔'], currentGameId: 'abc' });
  });

  it('ignora preferencias corruptas y almacenamiento bloqueado', () => {
    localStorage.setItem('buen-pagador:prefs', '{roto');
    expect(loadPrefs()).toEqual(defaultPrefs());
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => savePrefs(defaultPrefs())).not.toThrow();
    spy.mockRestore();
  });

  it('separa el partido de las preferencias', () => {
    const state = { ...defaultState(), title: 'Jueves', blocked: ['🐔'] };
    const { game, prefs } = splitState(state);
    expect(game).not.toHaveProperty('blocked');
    expect(game.title).toBe('Jueves');
    expect(prefs).toEqual({ includePhoto: true, blocked: ['🐔'], currentGameId: state.id });
  });

  it('cambia los emojis que ya no están permitidos', () => {
    const faces = [face(false, '🐷'), face(false, '🐸'), face(false, '🐔')];
    const out = refreshEmojis(faces, ['🐔']);
    expect(out[1].emoji).toBe('🐸');
    expect(DEBTOR_EMOJIS).toContain(out[0].emoji);
    expect(out.map((f) => f.emoji)).not.toContain('🐔');
  });
});

describe('migración de la versión anterior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('no hay nada que migrar', () => {
    expect(takeLegacy()).toBeNull();
  });

  it('convierte el partido guardado y lo borra de localStorage', () => {
    localStorage.setItem(
      'buen-pagador:v1',
      JSON.stringify({ image: 'data:x', title: 'Viejo', cost: 50, faces: [face(true)], blocked: ['🐔'], includePhoto: false }),
    );
    const legacy = takeLegacy()!;
    expect(legacy.prefs).toEqual({ includePhoto: false, blocked: ['🐔'] });
    expect(legacy.game).toMatchObject({ image: 'data:x', title: 'Viejo', cost: 50, currency: 'S/' });
    expect(localStorage.getItem('buen-pagador:v1')).toBeNull();
  });

  it('sin foto solo migra las preferencias', () => {
    localStorage.setItem('buen-pagador:v1', JSON.stringify({ title: 'Sin foto' }));
    expect(takeLegacy()).toEqual({ game: null, prefs: { includePhoto: true, blocked: [] } });
  });

  it('si no se puede borrar, igual migra', () => {
    localStorage.setItem('buen-pagador:v1', JSON.stringify({ image: 'data:x' }));
    const spy = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(takeLegacy()?.game?.image).toBe('data:x');
    spy.mockRestore();
  });
});
