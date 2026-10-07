import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  availableEmojis,
  computeTotals,
  DEBTOR_EMOJIS,
  defaultState,
  loadState,
  money,
  pickEmojis,
  saveState,
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

describe('persistencia', () => {
  afterEach(() => localStorage.clear());

  it('devuelve el estado por defecto si no hay nada', () => {
    expect(loadState()).toEqual(defaultState());
  });

  it('guarda y recupera, cambiando emojis que ya no están permitidos', () => {
    const state = { ...defaultState(), faces: [face(false, '🐷'), face(false, '🐸')], blocked: ['🐔'] };
    saveState(state);
    const loaded = loadState();
    expect(loaded.blocked).toEqual(['🐔']);
    expect(loaded.faces[1].emoji).toBe('🐸');
    expect(DEBTOR_EMOJIS).toContain(loaded.faces[0].emoji);
    expect(loaded.faces[0].emoji).not.toBe('🐸');
  });

  it('ignora datos corruptos', () => {
    localStorage.setItem('buen-pagador:v1', '{roto');
    expect(loadState()).toEqual(defaultState());
  });

  it('si la foto no cabe, guarda al menos los datos', () => {
    const setItem = vi.spyOn(localStorage, 'setItem');
    setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceeded');
    });
    saveState({ ...defaultState(), image: 'data:big', title: 'Jueves', faces: [face(true)] });
    expect(JSON.parse(localStorage.getItem('buen-pagador:v1')!)).toMatchObject({ image: null, faces: [], title: 'Jueves' });
  });

  it('no revienta si el almacenamiento no está disponible', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveState(defaultState())).not.toThrow();
  });
});
