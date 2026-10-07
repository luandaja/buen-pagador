// Almacén de links compartidos. Solo guarda datos cifrados en el navegador:
// el servidor nunca recibe la clave, así que no puede ver la foto ni los pagos.
import { Redis } from '@upstash/redis';

export interface ShareRecord {
  /** Foto cifrada (base64url). */
  img: string;
  /** Estado cifrado (base64url): caras, pagos, cuota, título. */
  state: string;
  /** SHA-256 del token de edición. */
  edit: string;
  /** Versión, sube con cada cambio. */
  v: number;
}

type Field = keyof ShareRecord;

/** Los links expiran a los 30 días sin cambios. */
export const TTL_SECONDS = 60 * 60 * 24 * 30;

const PREFIX = 'bp:share:';

interface Store {
  get(id: string, fields: Field[]): Promise<Partial<ShareRecord> | null>;
  create(id: string, record: ShareRecord): Promise<void>;
  updateState(id: string, state: string): Promise<number>;
  remove(id: string): Promise<void>;
}

function env(name: string): string | undefined {
  // En Vercel las variables llegan por process.env en tiempo de ejecución.
  const runtime = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
  return runtime?.[name] ?? (import.meta.env[name] as string | undefined);
}

function parse(raw: Record<string, unknown> | null, fields: Field[]): Partial<ShareRecord> | null {
  if (!raw || fields.every((f) => raw[f] == null)) return null;
  const out: Partial<ShareRecord> = {};
  for (const f of fields) {
    const value = raw[f];
    if (value == null) continue;
    if (f === 'v') out.v = Number(value);
    else out[f] = String(value);
  }
  return out;
}

class RedisStore implements Store {
  constructor(private redis: Redis) {}

  async get(id: string, fields: Field[]) {
    const raw = await this.redis.hmget<Record<string, unknown>>(PREFIX + id, ...fields);
    return parse(raw, fields);
  }

  async create(id: string, record: ShareRecord) {
    const key = PREFIX + id;
    const tx = this.redis.multi();
    tx.hset(key, { ...record, v: String(record.v) });
    tx.expire(key, TTL_SECONDS);
    await tx.exec();
  }

  async updateState(id: string, state: string) {
    const key = PREFIX + id;
    const tx = this.redis.multi();
    tx.hset(key, { state });
    tx.hincrby(key, 'v', 1);
    tx.expire(key, TTL_SECONDS);
    const [, v] = await tx.exec<[number, number, number]>();
    return Number(v);
  }

  async remove(id: string) {
    await this.redis.del(PREFIX + id);
  }
}

/** Solo para desarrollo local: se pierde al reiniciar el servidor. */
class MemoryStore implements Store {
  private data: Map<string, { record: ShareRecord; expires: number }>;

  constructor() {
    const g = globalThis as unknown as { __bpStore?: Map<string, { record: ShareRecord; expires: number }> };
    this.data = g.__bpStore ??= new Map();
  }

  private live(id: string) {
    const entry = this.data.get(id);
    if (entry && entry.expires < Date.now()) {
      this.data.delete(id);
      return undefined;
    }
    return entry;
  }

  async get(id: string, fields: Field[]) {
    const entry = this.live(id);
    return entry ? parse(entry.record as unknown as Record<string, unknown>, fields) : null;
  }

  async create(id: string, record: ShareRecord) {
    this.data.set(id, { record: { ...record }, expires: Date.now() + TTL_SECONDS * 1000 });
  }

  async updateState(id: string, state: string) {
    const entry = this.live(id);
    if (!entry) return 0;
    entry.record.state = state;
    entry.record.v += 1;
    entry.expires = Date.now() + TTL_SECONDS * 1000;
    return entry.record.v;
  }

  async remove(id: string) {
    this.data.delete(id);
  }
}

/** Credenciales de Upstash (nombres de la integración de Vercel o los de Upstash). */
export function credentials(): { url: string; token: string } | null {
  const url = env('KV_REST_API_URL') || env('UPSTASH_REDIS_REST_URL');
  const token = env('KV_REST_API_TOKEN') || env('UPSTASH_REDIS_REST_TOKEN');
  return url && token ? { url, token } : null;
}

function createStore(dev: boolean): Store {
  const creds = credentials();
  if (creds) return new RedisStore(new Redis({ ...creds, automaticDeserialization: false }));
  if (!dev) throw new Error('Falta configurar Upstash Redis (KV_REST_API_URL y KV_REST_API_TOKEN).');
  console.warn('[buen-pagador] Sin Upstash configurado: usando almacén en memoria.');
  return new MemoryStore();
}

let store: Store | null = null;

export function getStore(): Store {
  store ??= createStore(import.meta.env.DEV);
  return store;
}

/** Solo para tests: olvida el almacén elegido. */
export function resetStore() {
  store = null;
}

export { MemoryStore, RedisStore };
