import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Redis } from '@upstash/redis';

export interface ShareRecord {
  img: string;
  state: string;
  edit: string;
  v: number;
  pay?: string;
  pv?: number;
}

type Field = keyof ShareRecord;

export const TTL_SECONDS = 60 * 60 * 24 * 30;

const PREFIX = 'bp:share:';

interface Store {
  get(id: string, fields: Field[]): Promise<Partial<ShareRecord> | null>;
  create(id: string, record: ShareRecord): Promise<void>;
  updateState(id: string, state: string, pay?: string): Promise<number>;
  remove(id: string): Promise<void>;
}

function env(name: string): string | undefined {
  const runtime = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
  return runtime?.[name] ?? (import.meta.env[name] as string | undefined);
}

function parse(raw: Record<string, unknown> | null, fields: Field[]): Partial<ShareRecord> | null {
  if (!raw || fields.every((f) => raw[f] == null)) return null;
  const out: Partial<ShareRecord> = {};
  for (const f of fields) {
    const value = raw[f];
    if (value == null) continue;
    if (f === 'v' || f === 'pv') out[f] = Number(value);
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
    const raw: unknown = await this.redis.hmget(PREFIX + id, ...fields);
    return parse(toRecord(raw, fields), fields);
  }

  async create(id: string, record: ShareRecord) {
    const key = PREFIX + id;
    const tx = this.redis.multi();
    const { pay, pv, ...rest } = record;
    tx.hset(key, { ...rest, v: String(rest.v), pv: String(pv ?? 0), ...(pay ? { pay } : {}) });
    tx.expire(key, TTL_SECONDS);
    await tx.exec();
  }

  async updateState(id: string, state: string, pay?: string) {
    const key = PREFIX + id;
    const tx = this.redis.multi();
    tx.hset(key, pay ? { state, pay } : { state });
    tx.hincrby(key, 'v', 1);
    if (pay) tx.hincrby(key, 'pv', 1);
    tx.expire(key, TTL_SECONDS);
    const [, v] = await tx.exec<[number, number, number]>();
    return Number(v);
  }

  async remove(id: string) {
    await this.redis.del(PREFIX + id);
  }
}

type Entry = { record: ShareRecord; expires: number };

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

  async updateState(id: string, state: string, pay?: string) {
    const entry = this.live(id);
    if (!entry) return 0;
    entry.record.state = state;
    entry.record.v += 1;
    if (pay) Object.assign(entry.record, { pay, pv: (entry.record.pv ?? 0) + 1 });
    entry.expires = Date.now() + TTL_SECONDS * 1000;
    return entry.record.v;
  }

  async remove(id: string) {
    this.data.delete(id);
  }
}

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

  override async updateState(id: string, state: string, pay?: string) {
    this.load();
    const v = await super.updateState(id, state, pay);
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

export function resetStore() {
  store = null;
}

export { FileStore, MemoryStore, RedisStore };
