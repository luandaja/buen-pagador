// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FileGroupStore,
  getGroupStore,
  GROUP_TTL_SECONDS,
  MemoryGroupStore,
  RedisGroupStore,
  resetGroupStore,
} from '../../src/lib/group-store';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetGroupStore();
});

describe('MemoryGroupStore', () => {
  it('creates, patches fields, bumps the version and removes', async () => {
    const store = new MemoryGroupStore();
    await store.create('g1', 'hash', { m: 'meta', 'p:a': 'ana' });
    expect(await store.version('g1')).toBe(1);
    expect(await store.patch('g1', { 'e:x': 'taxi' }, ['p:a'])).toBe(2);
    expect(await store.get('g1')).toEqual({ edit: 'hash', v: 2, fields: { m: 'meta', 'e:x': 'taxi' } });
    await store.remove('g1');
    expect(await store.get('g1')).toBeNull();
    expect(await store.version('g1')).toBeNull();
    expect(await store.patch('g1', {}, [])).toBe(0);
  });

  it('returns copies and expires after 90 days without writes', async () => {
    vi.useFakeTimers();
    const store = new MemoryGroupStore();
    await store.create('g2', 'hash', { m: 'meta' });
    (await store.get('g2'))!.fields.m = 'changed';
    expect((await store.get('g2'))!.fields.m).toBe('meta');
    vi.advanceTimersByTime(GROUP_TTL_SECONDS * 1000 + 1);
    expect(await store.get('g2')).toBeNull();
  });
});

describe('FileGroupStore (development)', () => {
  it('shares data between instances through the file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bp-groups-'));
    const file = join(dir, 'groups.json');
    const first = new FileGroupStore(file);
    await first.create('g1', 'hash', { m: 'meta' });
    const second = new FileGroupStore(file);
    expect(await second.version('g1')).toBe(1);
    expect(await second.patch('g1', { 'p:a': 'ana' }, [])).toBe(2);
    expect((await first.get('g1'))!.fields).toEqual({ m: 'meta', 'p:a': 'ana' });
    await first.remove('g1');
    expect(await second.get('g1')).toBeNull();
    expect(await new FileGroupStore(join(dir, 'missing', 'x.json')).get('g1')).toBeNull();
    rmSync(dir, { recursive: true });
  });
});

describe('RedisGroupStore', () => {
  function fakeRedis(hash: Record<string, string> | null, version: string | null = null) {
    const transaction = { hset: vi.fn(), hdel: vi.fn(), hincrby: vi.fn(), expire: vi.fn(), exec: vi.fn(async () => [1, 1, 5, 1]) };
    const redis = { hgetall: vi.fn(async () => hash), hget: vi.fn(async () => version), multi: vi.fn(() => transaction), del: vi.fn() };
    return { redis, transaction, store: new RedisGroupStore(redis as never) };
  }

  it('reads the hash without exposing the edit hash as a field', async () => {
    const { store, redis } = fakeRedis({ m: 'meta', 'e:x': 'taxi', _edit: 'hash', _v: '4' }, '4');
    expect(await store.get('g1')).toEqual({ edit: 'hash', v: 4, fields: { m: 'meta', 'e:x': 'taxi' } });
    expect(redis.hgetall).toHaveBeenCalledWith('bp:group:g1');
    expect(await store.version('g1')).toBe(4);
    expect(await fakeRedis(null).store.get('g1')).toBeNull();
    expect(await fakeRedis({}).store.version('g1')).toBeNull();
  });

  it('reads the flat field/value list Upstash returns with deserialization off', async () => {
    const flat = ['m', 'meta', '_edit', 'hash', '_v', '2'] as unknown as Record<string, string>;
    expect(await fakeRedis(flat).store.get('g1')).toEqual({ edit: 'hash', v: 2, fields: { m: 'meta' } });
    expect(await fakeRedis([] as unknown as Record<string, string>).store.get('g1')).toBeNull();
  });

  it('creates with expiry and patches in one transaction', async () => {
    const { store, transaction, redis } = fakeRedis(null);
    await store.create('g1', 'hash', { m: 'meta' });
    expect(transaction.hset).toHaveBeenCalledWith('bp:group:g1', { m: 'meta', _edit: 'hash', _v: '1' });
    expect(transaction.expire).toHaveBeenCalledWith('bp:group:g1', GROUP_TTL_SECONDS);

    expect(await store.patch('g1', { 'p:a': 'ana' }, ['e:x'])).toBe(5);
    expect(transaction.hdel).toHaveBeenCalledWith('bp:group:g1', 'e:x');
    expect(transaction.hincrby).toHaveBeenCalledWith('bp:group:g1', '_v', 1);

    transaction.hset.mockClear();
    transaction.hdel.mockClear();
    transaction.exec.mockResolvedValueOnce([6, 1]);
    expect(await store.patch('g1', {}, [])).toBe(6);
    expect(transaction.hset).not.toHaveBeenCalled();
    expect(transaction.hdel).not.toHaveBeenCalled();

    await store.remove('g1');
    expect(redis.del).toHaveBeenCalledWith('bp:group:g1');
  });
});

describe('getGroupStore', () => {
  it('uses Redis with credentials, memory in tests and fails in production', () => {
    expect(getGroupStore()).toBeInstanceOf(MemoryGroupStore);
    resetGroupStore();
    vi.stubEnv('KV_REST_API_URL', 'https://kv');
    vi.stubEnv('KV_REST_API_TOKEN', 'tok');
    expect(getGroupStore()).toBeInstanceOf(RedisGroupStore);
    expect(getGroupStore()).toBe(getGroupStore());
    resetGroupStore();
    vi.unstubAllEnvs();
    vi.stubEnv('DEV', false);
    expect(() => getGroupStore()).toThrow(/Upstash/);
  });

  it('uses a file in development', () => {
    vi.stubEnv('MODE', 'development');
    expect(getGroupStore()).toBeInstanceOf(FileGroupStore);
  });
});

describe('group link lifetime', () => {
  it('reports the seconds left in every store', async () => {
    const memory = new MemoryGroupStore();
    await memory.create('life', 'hash', { m: 'meta' });
    expect(await memory.ttl('life')).toBe(GROUP_TTL_SECONDS);
    expect(await memory.ttl('missing')).toBeNull();
    const redis = { ttl: vi.fn(async () => -1) };
    expect(await new RedisGroupStore(redis as never).ttl('id')).toBeNull();
    redis.ttl.mockResolvedValueOnce(99);
    expect(await new RedisGroupStore(redis as never).ttl('id')).toBe(99);

    const dir = mkdtempSync(join(tmpdir(), 'bp-gttl-'));
    const file = new FileGroupStore(join(dir, 'g.json'));
    await file.create('g', 'hash', { m: 'meta' });
    expect(await new FileGroupStore(join(dir, 'g.json')).ttl('g')).toBe(GROUP_TTL_SECONDS);
    rmSync(dir, { recursive: true });
  });
});
