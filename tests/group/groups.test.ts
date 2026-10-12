import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { database, DB_NAME, resetDatabase } from '../../src/scripts/db';
import { listGames } from '../../src/scripts/games';
import { currentGroupId, deleteGroup, listGroups, loadGroup, rememberGroup, saveGroup } from '../../src/scripts/group/groups';
import { newGroup } from '../../src/scripts/group/model';
import { newGame } from '../../src/scripts/state';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDatabase();
  localStorage.clear();
});

describe('groups in IndexedDB', () => {
  it('saves, lists newest first, loads and deletes with its receipts', async () => {
    const old = { ...newGroup({ title: 'Old' }), updatedAt: 1 };
    const recent = { ...newGroup({ title: 'New' }), updatedAt: 2 };
    await saveGroup(old);
    await saveGroup(recent);
    const db = await database();
    await db.put('receipts', 'data:r1', `${old.id}:e1`);
    await db.put('receipts', 'data:r2', `${recent.id}:e1`);

    expect((await listGroups()).map((group) => group.title)).toEqual(['New', 'Old']);
    expect(await loadGroup(old.id)).toEqual(old);

    await deleteGroup(old.id);
    expect(await loadGroup(old.id)).toBeNull();
    expect(await db.getAllKeys('receipts')).toEqual([`${recent.id}:e1`]);
  });

  it('keeps the court games of a version 1 database when upgrading', async () => {
    const game = { ...newGame({ title: 'Jueves' }) };
    const { image: _image, ...meta } = game;
    const v1 = await openDB(DB_NAME, 1, {
      upgrade(upgrading) {
        upgrading.createObjectStore('games', { keyPath: 'id' });
        upgrading.createObjectStore('images');
      },
    });
    await v1.put('games', meta);
    v1.close();

    expect((await listGames()).map((stored) => stored.title)).toEqual(['Jueves']);
    expect(await listGroups()).toEqual([]);
  });
});

describe('current group', () => {
  it('remembers and forgets the open group', () => {
    expect(currentGroupId()).toBeNull();
    rememberGroup('g1');
    expect(currentGroupId()).toBe('g1');
    rememberGroup(null);
    expect(currentGroupId()).toBeNull();
  });

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(currentGroupId()).toBeNull();
    expect(() => rememberGroup('g1')).not.toThrow();
  });
});
