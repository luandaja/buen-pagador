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

function database() {
  dbPromise ??= openDB<Schema>('buen-pagador', 1, {
    upgrade(upgradingDatabase) {
      upgradingDatabase.createObjectStore('games', { keyPath: 'id' });
      upgradingDatabase.createObjectStore('images');
    },
  });
  return dbPromise;
}

const withDefaults = (meta: StoredGame): GameMeta => ({ payNote: '', payQr: null, ...meta });

export async function listGames(): Promise<GameMeta[]> {
  const storedGames = await (await database()).getAll('games');
  return storedGames.map(withDefaults).sort((first, second) => second.updatedAt - first.updatedAt);
}

export async function loadGame(gameId: string): Promise<Game | null> {
  const connection = await database();
  const [meta, image] = await Promise.all([connection.get('games', gameId), connection.get('images', gameId)]);
  if (!meta) return null;
  if (image) savedImages.set(gameId, image);
  return { ...withDefaults(meta), image: image ?? null };
}

export async function saveGame(game: Game): Promise<void> {
  const { image, ...meta } = game;
  const transaction = (await database()).transaction(['games', 'images'], 'readwrite');
  const writes: Promise<unknown>[] = [transaction.objectStore('games').put(meta)];
  if (image && savedImages.get(game.id) !== image) {
    writes.push(transaction.objectStore('images').put(image, game.id));
    savedImages.set(game.id, image);
  }
  await Promise.all([...writes, transaction.done]);
}

export async function deleteGame(gameId: string): Promise<void> {
  const transaction = (await database()).transaction(['games', 'images'], 'readwrite');
  await Promise.all([transaction.objectStore('games').delete(gameId), transaction.objectStore('images').delete(gameId), transaction.done]);
  savedImages.delete(gameId);
}

export async function findByShareId(shareId: string): Promise<GameMeta | undefined> {
  return (await listGames()).find((game) => game.share?.id === shareId);
}

export function resetGamesDb() {
  dbPromise = null;
  savedImages.clear();
}
