import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase } from '../src/scripts/db';
import { saveGame } from '../src/scripts/games';
import { loadPreview } from '../src/scripts/preview';
import { newGame, savePrefs } from '../src/scripts/state';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDatabase();
  localStorage.clear();
});

describe('court preview', () => {
  it('shows nothing without a current game with photo', async () => {
    expect(await loadPreview()).toBeNull();
    const game = newGame({ title: 'Jueves' });
    await saveGame({ ...game, image: null });
    savePrefs({ includePhoto: true, blocked: [], currentGameId: game.id });
    expect(await loadPreview()).toBeNull();
  });

  it('previews a game without photo once it has people', async () => {
    const game = { ...newGame({ title: 'Jueves', quota: 10 }), faces: [{ id: 'a', x: 0, y: 0, w: 0, h: 0, emoji: '🐸', paid: false }] };
    await saveGame(game);
    savePrefs({ includePhoto: true, blocked: [], currentGameId: game.id });
    expect(await loadPreview()).toMatchObject({ image: null, shared: { quota: 10, faces: [{ id: 'a' }] } });
  });

  it('builds what the public viewer shows, with payment details only when present', async () => {
    const game = { ...newGame({ title: 'Jueves', cost: 100 }), image: 'data:image/jpeg;base64,FOTO' };
    await saveGame(game);
    savePrefs({ includePhoto: true, blocked: [], currentGameId: game.id });
    expect(await loadPreview()).toMatchObject({ image: 'data:image/jpeg;base64,FOTO', pay: null, shared: { title: 'Jueves', cost: 100 } });
    await saveGame({ ...game, payNote: 'Yape 999' });
    expect((await loadPreview())!.pay).toEqual({ note: 'Yape 999', qr: null });
  });
});
