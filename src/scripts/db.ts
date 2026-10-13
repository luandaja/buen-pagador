import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Group } from './group/model';
import type { GameMeta } from './games';

type StoredGame = Omit<GameMeta, 'payNote' | 'payQr'> & Partial<Pick<GameMeta, 'payNote' | 'payQr'>>;

export interface Schema extends DBSchema {
  games: { key: string; value: StoredGame };
  images: { key: string; value: string };
  groups: { key: string; value: Group };
  receipts: { key: string; value: string };
  // Which shared link each receipt photo was last uploaded to, keyed like `receipts`.
  receiptUploads: { key: string; value: string };
}

export const DB_NAME = 'buen-pagador';
export const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

export function database() {
  dbPromise ??= openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(upgradingDatabase, oldVersion) {
      if (oldVersion < 1) {
        upgradingDatabase.createObjectStore('games', { keyPath: 'id' });
        upgradingDatabase.createObjectStore('images');
      }
      if (oldVersion < 2) {
        upgradingDatabase.createObjectStore('groups', { keyPath: 'id' });
        upgradingDatabase.createObjectStore('receipts');
      }
      if (oldVersion < 3) upgradingDatabase.createObjectStore('receiptUploads');
    },
  });
  return dbPromise;
}

export function resetDatabase() {
  dbPromise = null;
}
