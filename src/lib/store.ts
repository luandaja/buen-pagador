// Almacén de links compartidos. Solo guarda datos cifrados en el navegador:
// el servidor nunca recibe la clave, así que no puede ver la foto ni los pagos.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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

function toRecord(raw: unknown, fields: Field[]): Record<string, unknown> | null {
  if (!Array.isArray(raw)) return raw as Record<string, unknown> | null;
  return Object.fromEntries(fields.map((f, i) => [f, raw[i]]));
}

class RedisStore implements Store {
  constructor(private redis: Redis) {}

  async get(id: string, fields: Field[]) {
    // Sin deserialización automática, Upstash devuelve los valores como arreglo, en el orden pedido.
    const raw: unknown = await this.redis.hmget(PREFIX + id, ...fields);
    return parse(toRecord(raw, fields), fields);
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

type Entry = { record: ShareRecord; expires: number };

/** Para tests: vive en memoria. */
class MemoryStore implements Store {
  protected data: Map<string, Entry>;

  constructor() {
    const g = globalThis as unknown as { __bpStore?: Map<string, Entry> };
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

function createStore(dev: boolean, mode: string): Store {
  const creds = credentials();
  if (creds) return new RedisStore(new Redis({ ...creds, automaticDeserialization: false }));
  if (!dev) throw new Error('Falta configurar Upstash Redis (KV_REST_API_URL y KV_REST_API_TOKEN).');
  if (mode === 'test') return new MemoryStore();
  console.warn('[buen-pagador] Sin Upstash configurado: guardando los links en .astro/dev-shares.json.');
  return new FileStore('.astro/dev-shares.json');
}

/**
 * Para `astro dev`: guarda en un archivo, porque el servidor de desarrollo
 * puede atender cada petición con un módulo nuevo y perder la memoria.
 */
class FileStore extends MemoryStore {
  constructor(private file: string) {
    super();
  }

  private load() {
    try {
      this.data = new Map(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      this.data = new Map();
    }
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify([...this.data]));
  }

  override async get(id: string, fields: Field[]) {
    this.load();
    return super.get(id, fields);
  }

  override async create(id: string, record: ShareRecord) {
    this.load();
    await super.create(id, record);
    this.save();
  }

  override async updateState(id: string, state: string) {
    this.load();
    const v = await super.updateState(id, state);
    this.save();
    return v;
  }

  override async remove(id: string) {
    this.load();
    await super.remove(id);
    this.save();
  }
}

let store: Store | null = null;

export function getStore(): Store {
  store ??= createStore(import.meta.env.DEV, import.meta.env.MODE);
  return store;
}

/** Solo para tests: olvida el almacén elegido. */
export function resetStore() {
  store = null;
}

export { FileStore, MemoryStore, RedisStore };
