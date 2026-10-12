import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Redis } from '@upstash/redis';
import { credentials } from './store';

export type Fields = Record<string, string>;

export interface GroupRecord {
  fields: Fields;
  edit: string;
  v: number;
}

export interface GroupStore {
  version(id: string): Promise<number | null>;
  get(id: string): Promise<GroupRecord | null>;
  create(id: string, edit: string, fields: Fields): Promise<void>;
  patch(id: string, set: Fields, del: string[]): Promise<number>;
  remove(id: string): Promise<void>;
  ttl(id: string): Promise<number | null>;
}

export const GROUP_TTL_SECONDS = 60 * 60 * 24 * 90;

const PREFIX = 'bp:group:';
const EDIT = '_edit';
const VERSION = '_v';

function toRecord(raw: Record<string, unknown> | null): GroupRecord | null {
  if (!raw || raw[EDIT] == null) return null;
  const { [EDIT]: edit, [VERSION]: version, ...fields } = raw;
  return { edit: String(edit), v: Number(version), fields: Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, String(value)])) };
}

class RedisGroupStore implements GroupStore {
  constructor(private redis: Redis) {}

  async version(id: string) {
    const version = await this.redis.hget<string>(PREFIX + id, VERSION);
    return version == null ? null : Number(version);
  }

  async get(id: string) {
    return toRecord(await this.redis.hgetall(PREFIX + id));
  }

  async create(id: string, edit: string, fields: Fields) {
    const key = PREFIX + id;
    const transaction = this.redis.multi();
    transaction.hset(key, { ...fields, [EDIT]: edit, [VERSION]: '1' });
    transaction.expire(key, GROUP_TTL_SECONDS);
    await transaction.exec();
  }

  async patch(id: string, set: Fields, del: string[]) {
    const key = PREFIX + id;
    const transaction = this.redis.multi();
    if (Object.keys(set).length) transaction.hset(key, set);
    if (del.length) transaction.hdel(key, ...del);
    transaction.hincrby(key, VERSION, 1);
    transaction.expire(key, GROUP_TTL_SECONDS);
    const results = await transaction.exec<number[]>();
    return Number(results.at(-2));
  }

  async remove(id: string) {
    await this.redis.del(PREFIX + id);
  }

  async ttl(id: string) {
    const seconds = await this.redis.ttl(PREFIX + id);
    return seconds > 0 ? seconds : null;
  }
}

type Entry = { record: GroupRecord; expires: number };

class MemoryGroupStore implements GroupStore {
  protected data: Map<string, Entry>;

  constructor() {
    const globalScope = globalThis as unknown as { __bpGroups?: Map<string, Entry> };
    this.data = globalScope.__bpGroups ??= new Map();
  }

  private live(id: string) {
    const entry = this.data.get(id);
    if (entry && entry.expires < Date.now()) this.data.delete(id);
    return this.data.get(id);
  }

  async version(id: string) {
    return this.live(id)?.record.v ?? null;
  }

  async get(id: string) {
    const entry = this.live(id);
    return entry ? structuredClone(entry.record) : null;
  }

  async create(id: string, edit: string, fields: Fields) {
    this.data.set(id, { record: { fields: { ...fields }, edit, v: 1 }, expires: Date.now() + GROUP_TTL_SECONDS * 1000 });
  }

  async patch(id: string, set: Fields, del: string[]) {
    const entry = this.live(id);
    if (!entry) return 0;
    Object.assign(entry.record.fields, set);
    for (const name of del) delete entry.record.fields[name];
    entry.record.v += 1;
    entry.expires = Date.now() + GROUP_TTL_SECONDS * 1000;
    return entry.record.v;
  }

  async remove(id: string) {
    this.data.delete(id);
  }

  async ttl(id: string) {
    const entry = this.live(id);
    return entry ? Math.ceil((entry.expires - Date.now()) / 1000) : null;
  }
}

class FileGroupStore extends MemoryGroupStore {
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

  override async version(id: string) {
    this.load();
    return super.version(id);
  }

  override async get(id: string) {
    this.load();
    return super.get(id);
  }

  override async create(id: string, edit: string, fields: Fields) {
    this.load();
    await super.create(id, edit, fields);
    this.save();
  }

  override async patch(id: string, set: Fields, del: string[]) {
    this.load();
    const version = await super.patch(id, set, del);
    this.save();
    return version;
  }

  override async remove(id: string) {
    this.load();
    await super.remove(id);
    this.save();
  }

  override async ttl(id: string) {
    this.load();
    return super.ttl(id);
  }
}

function createGroupStore(isDev: boolean, mode: string): GroupStore {
  const upstash = credentials();
  if (upstash) return new RedisGroupStore(new Redis({ ...upstash, automaticDeserialization: false }));
  if (!isDev) throw new Error('Upstash Redis is not configured (KV_REST_API_URL and KV_REST_API_TOKEN).');
  if (mode === 'test') return new MemoryGroupStore();
  return new FileGroupStore('.astro/dev-groups.json');
}

let store: GroupStore | null = null;

export function getGroupStore(): GroupStore {
  store ??= createGroupStore(import.meta.env.DEV, import.meta.env.MODE);
  return store;
}

export function resetGroupStore() {
  store = null;
}

export { FileGroupStore, MemoryGroupStore, RedisGroupStore };
