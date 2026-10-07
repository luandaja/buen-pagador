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
  createId,
  type Face,
} from '../src/scripts/state';

const face = (paid: boolean, emoji = '🐸'): Face => ({ id: createId(), x: 0, y: 0, w: 0.1, h: 0.1, emoji, paid });

describe('computeTotals', () => {
  it('no share without cost or players', () => {
    expect(computeTotals({ faces: [], cost: null, rounding: 0 })).toEqual({
      people: 0,
      paid: 0,
      share: null,
      collected: null,
      missing: null,
      paidRatio: 0,
    });
  });

  it('splits the cost and adds up what was collected', () => {
    const totals = computeTotals({ faces: [face(true), face(false), face(false), face(true)], cost: 100, rounding: 0 });
    expect(totals).toMatchObject({ people: 4, paid: 2, share: 25, collected: 50, missing: 50, paidRatio: 0.5 });
  });

  it('rounds the share up', () => {
    const faces = [face(false), face(false), face(false)];
    expect(computeTotals({ faces, cost: 100, rounding: 0.5 }).share).toBe(33.5);
    expect(computeTotals({ faces, cost: 100, rounding: 1 }).share).toBe(34);
    expect(computeTotals({ faces, cost: 90, rounding: 1 }).share).toBe(30);
  });

  it('zero cost yields no amounts', () => {
    expect(computeTotals({ faces: [face(true)], cost: 0, rounding: 0 }).share).toBeNull();
  });
});

describe('money', () => {
  it('formats with currency and a non-breaking space', () => {
    expect(money(12, 'S/')).toBe('S/ 12');
    expect(money(4.825, 'S/')).toBe('S/ 4.83');
    expect(money(7, '')).toBe('7');
    expect(money(null, 'S/')).toBe('—');
  });
});

describe('emojis', () => {
  it('does not repeat while enough remain and avoids the given ones', () => {
    const picked = pickEmojis(5, ['🐸']);
    expect(new Set(picked).size).toBe(5);
    expect(picked).not.toContain('🐸');
  });

  it('respects blocked emojis and starts over when exhausted', () => {
    const blocked = DEBTOR_EMOJIS.slice(0, 18);
    const picked = pickEmojis(5, [], blocked);
    expect(picked.every((emoji) => !blocked.includes(emoji))).toBe(true);
  });

  it('still uses allowed emojis when all are avoided', () => {
    const allowed = availableEmojis([]);
    expect(pickEmojis(2, allowed)).toHaveLength(2);
  });

  it('uses the full list when everything is blocked', () => {
    expect(availableEmojis([...DEBTOR_EMOJIS])).toEqual(DEBTOR_EMOJIS);
  });
});

describe('games and preferences', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('newGame creates an empty game with id and dates, accepting base data', () => {
    const game = newGame({ title: 'Thursday', cost: 90 });
    expect(game).toMatchObject({ title: 'Thursday', cost: 90, currency: 'S/', faces: [], image: null, share: null });
    expect(game.id).toMatch(/^\w+$/);
    expect(game.createdAt).toBe(game.updatedAt);
  });

  it('defaultState combines a new game with default preferences', () => {
    expect(defaultState()).toMatchObject({ includePhoto: true, blocked: [] });
    expect(defaultState()).not.toHaveProperty('currentGameId');
  });

  it('saves and loads preferences', () => {
    expect(loadPrefs()).toEqual(defaultPrefs());
    savePrefs({ includePhoto: false, blocked: ['🐔'], currentGameId: 'abc' });
    expect(loadPrefs()).toEqual({ includePhoto: false, blocked: ['🐔'], currentGameId: 'abc' });
  });

  it('ignores corrupt preferences and blocked storage', () => {
    localStorage.setItem('buen-pagador:prefs', '{roto');
    expect(loadPrefs()).toEqual(defaultPrefs());
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => savePrefs(defaultPrefs())).not.toThrow();
    spy.mockRestore();
  });

  it('splits the game from the preferences', () => {
    const state = { ...defaultState(), title: 'Thursday', blocked: ['🐔'] };
    const { game, prefs } = splitState(state);
    expect(game).not.toHaveProperty('blocked');
    expect(game.title).toBe('Thursday');
    expect(prefs).toEqual({ includePhoto: true, blocked: ['🐔'], currentGameId: state.id });
  });

  it('replaces emojis that are no longer allowed', () => {
    const faces = [face(false, '🐷'), face(false, '🐸'), face(false, '🐔')];
    const out = refreshEmojis(faces, ['🐔']);
    expect(out[1].emoji).toBe('🐸');
    expect(DEBTOR_EMOJIS).toContain(out[0].emoji);
    expect(out.map((face) => face.emoji)).not.toContain('🐔');
  });
});

describe('migration from the previous version', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('nothing to migrate', () => {
    expect(takeLegacy()).toBeNull();
  });

  it('converts the saved game and removes it from localStorage', () => {
    localStorage.setItem(
      'buen-pagador:v1',
      JSON.stringify({ image: 'data:x', title: 'Old', cost: 50, faces: [face(true)], blocked: ['🐔'], includePhoto: false }),
    );
    const legacy = takeLegacy()!;
    expect(legacy.prefs).toEqual({ includePhoto: false, blocked: ['🐔'] });
    expect(legacy.game).toMatchObject({ image: 'data:x', title: 'Old', cost: 50, currency: 'S/' });
    expect(localStorage.getItem('buen-pagador:v1')).toBeNull();
  });

  it('without a photo only preferences migrate', () => {
    localStorage.setItem('buen-pagador:v1', JSON.stringify({ title: 'No photo' }));
    expect(takeLegacy()).toEqual({ game: null, prefs: { includePhoto: true, blocked: [] } });
  });

  it('still migrates when removal fails', () => {
    localStorage.setItem('buen-pagador:v1', JSON.stringify({ image: 'data:x' }));
    const spy = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(takeLegacy()?.game?.image).toBe('data:x');
    spy.mockRestore();
  });
});
