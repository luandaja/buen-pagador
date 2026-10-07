import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Game } from './state';

export type GameMeta = Omit<Game, 'image'>;
type StoredGame = Omit<GameMeta, 'payNote' | 'payQr'> & Partial<Pick<GameMeta, 'payNote' | 'payQr'>>;

interface Schema extends DBSchema {
  games: { key: string; value: StoredGame };
  images: { key: string; value: string };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;
const savedImages = new Map<string, string>();

function db() {
  dbPromise ??= openDB<Schema>('buen-pagador', 1, {
    upgrade(database) {
      database.createObjectStore('games', { keyPath: 'id' });
      database.createObjectStore('images');
    },
  });
  return dbPromise;
}

const withDefaults = (meta: StoredGame): GameMeta => ({ payNote: '', payQr: null, ...meta });

export async function listGames(): Promise<GameMeta[]> {
  const all = await (await db()).getAll('games');
  return all.map(withDefaults).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadGame(id: string): Promise<Game | null> {
  const database = await db();
  const [meta, image] = await Promise.all([database.get('games', id), database.get('images', id)]);
  if (!meta) return null;
  if (image) savedImages.set(id, image);
  return { ...withDefaults(meta), image: image ?? null };
}

export async function saveGame(game: Game): Promise<void> {
  const { image, ...meta } = game;
  const tx = (await db()).transaction(['games', 'images'], 'readwrite');
  const writes: Promise<unknown>[] = [tx.objectStore('games').put(meta)];
  if (image && savedImages.get(game.id) !== image) {
    writes.push(tx.objectStore('images').put(image, game.id));
    savedImages.set(game.id, image);
  }
  await Promise.all([...writes, tx.done]);
}

export async function deleteGame(id: string): Promise<void> {
  const tx = (await db()).transaction(['games', 'images'], 'readwrite');
  await Promise.all([tx.objectStore('games').delete(id), tx.objectStore('images').delete(id), tx.done]);
  savedImages.delete(id);
}

export async function findByShareId(shareId: string): Promise<GameMeta | undefined> {
  return (await listGames()).find((g) => g.share?.id === shareId);
}

export function resetGamesDb() {
  dbPromise = null;
  savedImages.clear();
}
