import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteGame, findByShareId, listGames, loadGame, resetGamesDb, saveGame } from '../src/scripts/games';
import { newGame } from '../src/scripts/state';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetGamesDb();
});

describe('IndexedDB history', () => {
  it('saves, lists newest first and loads with the photo', async () => {
    const old = { ...newGame({ title: 'Old' }), updatedAt: 1, image: 'data:old' };
    const recent = { ...newGame({ title: 'New' }), updatedAt: 2, image: 'data:new' };
    await saveGame(old);
    await saveGame(recent);

    const list = await listGames();
    expect(list.map((game) => game.title)).toEqual(['New', 'Old']);
    expect(list[0]).not.toHaveProperty('image');
    expect((await loadGame(old.id))?.image).toBe('data:old');
  });

  it('does not rewrite an unchanged photo but saves the data', async () => {
    const game = { ...newGame({ title: 'A' }), image: 'data:photo' };
    await saveGame(game);
    await saveGame({ ...game, title: 'B' });
    expect(await loadGame(game.id)).toMatchObject({ title: 'B', image: 'data:photo' });
  });

  it('loads games without a photo and returns null when missing', async () => {
    const game = newGame();
    await saveGame(game);
    expect((await loadGame(game.id))?.image).toBeNull();
    expect(await loadGame('missing')).toBeNull();
  });

  it('fills in new fields for games saved by older versions', async () => {
    const { payNote: _n, payQr: _q, ...old } = newGame({ title: 'Old' });
    await saveGame(old as never);
    expect(await loadGame(old.id)).toMatchObject({ title: 'Old', payNote: '', payQr: null });
    expect((await listGames())[0]).toMatchObject({ payNote: '', payQr: null });
  });

  it('deletes the game and its photo', async () => {
    const game = { ...newGame(), image: 'data:photo' };
    await saveGame(game);
    await deleteGame(game.id);
    expect(await loadGame(game.id)).toBeNull();
    expect(await listGames()).toEqual([]);
  });

  it('finds the game that uses a link', async () => {
    const link = { id: 'AbCdEfGhIj', key: 'k', token: 't' };
    const game = { ...newGame(), share: link };
    await saveGame(game);
    await saveGame(newGame());
    expect((await findByShareId(link.id))?.id).toBe(game.id);
    expect(await findByShareId('other')).toBeUndefined();
  });
});
