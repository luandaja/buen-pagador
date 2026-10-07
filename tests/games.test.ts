import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteGame, findByShareId, listGames, loadGame, resetGamesDb, saveGame } from '../src/scripts/games';
import { newGame } from '../src/scripts/state';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetGamesDb();
});

describe('historial en IndexedDB', () => {
  it('guarda, lista del más reciente al más antiguo y carga con la foto', async () => {
    const old = { ...newGame({ title: 'Viejo' }), updatedAt: 1, image: 'data:viejo' };
    const recent = { ...newGame({ title: 'Nuevo' }), updatedAt: 2, image: 'data:nuevo' };
    await saveGame(old);
    await saveGame(recent);

    const list = await listGames();
    expect(list.map((g) => g.title)).toEqual(['Nuevo', 'Viejo']);
    expect(list[0]).not.toHaveProperty('image');
    expect((await loadGame(old.id))?.image).toBe('data:viejo');
  });

  it('no reescribe la foto si no cambió, pero sí los datos', async () => {
    const game = { ...newGame({ title: 'A' }), image: 'data:foto' };
    await saveGame(game);
    await saveGame({ ...game, title: 'B' });
    expect(await loadGame(game.id)).toMatchObject({ title: 'B', image: 'data:foto' });
  });

  it('carga partidos sin foto y devuelve null si no existe', async () => {
    const game = newGame();
    await saveGame(game);
    expect((await loadGame(game.id))?.image).toBeNull();
    expect(await loadGame('nada')).toBeNull();
  });

  it('borra el partido y su foto', async () => {
    const game = { ...newGame(), image: 'data:foto' };
    await saveGame(game);
    await deleteGame(game.id);
    expect(await loadGame(game.id)).toBeNull();
    expect(await listGames()).toEqual([]);
  });

  it('encuentra el partido que usa un link', async () => {
    const link = { id: 'AbCdEfGhIj', key: 'k', token: 't' };
    const game = { ...newGame(), share: link };
    await saveGame(game);
    await saveGame(newGame());
    expect((await findByShareId(link.id))?.id).toBe(game.id);
    expect(await findByShareId('otro')).toBeUndefined();
  });
});
