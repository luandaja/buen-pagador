// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentials, FileStore, getStore, MemoryStore, RedisStore, resetStore, TTL_SECONDS, type ShareRecord } from '../src/lib/store';

const record: ShareRecord = { img: 'img', state: 'st', edit: 'hash', v: 1 };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetStore();
});

describe('MemoryStore', () => {
  it('creates, reads fields, updates and removes', async () => {
    const store = new MemoryStore();
    await store.create('abc', record);
    expect(await store.get('abc', ['state', 'v'])).toEqual({ state: 'st', v: 1 });
    expect(await store.updateState('abc', 'st2')).toBe(2);
    expect(await store.get('abc', ['state', 'v', 'img'])).toEqual({ state: 'st2', v: 2, img: 'img' });
    await store.remove('abc');
    expect(await store.get('abc', ['state'])).toBeNull();
    expect(await store.updateState('abc', 'x')).toBe(0);
  });

  it('stores payment details and bumps their version only when sent', async () => {
    const store = new MemoryStore();
    await store.create('pay', { ...record, pay: 'p1', pv: 1 });
    await store.updateState('pay', 's2');
    expect(await store.get('pay', ['pay', 'pv'])).toEqual({ pay: 'p1', pv: 1 });
    await store.updateState('pay', 's3', 'p2');
    expect(await store.get('pay', ['pay', 'pv'])).toEqual({ pay: 'p2', pv: 2 });
  });

  it('expires after 30 days', async () => {
    vi.useFakeTimers();
    const store = new MemoryStore();
    await store.create('exp', record);
    vi.advanceTimersByTime(TTL_SECONDS * 1000 + 1);
    expect(await store.get('exp', ['state'])).toBeNull();
  });
});

describe('FileStore (development)', () => {
  it('writes to a file another instance can read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bp-'));
    const file = join(dir, 'sub', 'shares.json');
    const firstStore = new FileStore(file);
    await firstStore.create('abc', record);
    expect(JSON.parse(readFileSync(file, 'utf8'))[0][0]).toBe('abc');

    const secondStore = new FileStore(file);
    expect(await secondStore.get('abc', ['state'])).toEqual({ state: 'st' });
    expect(await secondStore.updateState('abc', 'st2')).toBe(2);
    expect(await firstStore.get('abc', ['state', 'v'])).toEqual({ state: 'st2', v: 2 });
    await firstStore.remove('abc');
    expect(await secondStore.get('abc', ['state'])).toBeNull();
    rmSync(dir, { recursive: true });
  });

  it('a missing or broken file is an empty store', async () => {
    expect(await new FileStore(join(tmpdir(), 'bp-missing', 'x.json')).get('abc', ['state'])).toBeNull();
  });
});

describe('RedisStore', () => {
  function fakeRedis(hmget: unknown) {
    const transaction = { hset: vi.fn(), expire: vi.fn(), hincrby: vi.fn(), exec: vi.fn(async () => [1, 7, 1]) };
    const redis = { hmget: vi.fn(async () => hmget), multi: vi.fn(() => transaction), del: vi.fn() };
    return { redis, transaction, store: new RedisStore(redis as never) };
  }

  it('reads fields and parses the version as a number', async () => {
    const { store, redis } = fakeRedis({ state: 's', v: '3' });
    expect(await store.get('id', ['state', 'v'])).toEqual({ state: 's', v: 3 });
    expect(redis.hmget).toHaveBeenCalledWith('bp:share:id', 'state', 'v');
  });

  it('handles the real Upstash reply: an array in request order', async () => {
    const { store } = fakeRedis(['s', '3', null]);
    expect(await store.get('id', ['state', 'v', 'img'])).toEqual({ state: 's', v: 3 });
    expect(await fakeRedis([null, null]).store.get('id', ['state', 'v'])).toBeNull();
  });

  it('returns null when missing', async () => {
    expect(await fakeRedis(null).store.get('id', ['state'])).toBeNull();
    expect(await fakeRedis({ state: null }).store.get('id', ['state'])).toBeNull();
  });

  it('creates with expiry and bumps the version on update', async () => {
    const { store, transaction, redis } = fakeRedis(null);
    await store.create('id', record);
    expect(transaction.hset).toHaveBeenCalledWith('bp:share:id', { ...record, v: '1', pv: '0' });
    expect(transaction.expire).toHaveBeenCalledWith('bp:share:id', TTL_SECONDS);
    expect(await store.updateState('id', 'next-state')).toBe(7);
    expect(transaction.hincrby).toHaveBeenCalledWith('bp:share:id', 'v', 1);
    expect(transaction.hincrby).not.toHaveBeenCalledWith('bp:share:id', 'pv', 1);
    await store.create('id2', { ...record, pay: 'p', pv: 1 });
    expect(transaction.hset).toHaveBeenLastCalledWith('bp:share:id2', { ...record, v: '1', pv: '1', pay: 'p' });
    await store.updateState('id2', 'next-state', 'p2');
    expect(transaction.hset).toHaveBeenLastCalledWith('bp:share:id2', { state: 'next-state', pay: 'p2' });
    expect(transaction.hincrby).toHaveBeenLastCalledWith('bp:share:id2', 'pv', 1);
    await store.remove('id');
    expect(redis.del).toHaveBeenCalledWith('bp:share:id');
  });
});

describe('getStore', () => {
  it('reads Vercel or Upstash credentials', () => {
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_TOKEN', '');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://u');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 't');
    expect(credentials()).toEqual({ url: 'https://u', token: 't' });
  });

  it('uses Redis when credentials exist', () => {
    vi.stubEnv('KV_REST_API_URL', 'https://kv');
    vi.stubEnv('KV_REST_API_TOKEN', 'tok');
    expect(getStore()).toBeInstanceOf(RedisStore);
    expect(getStore()).toBe(getStore());
  });

  it('uses memory in tests without credentials', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(credentials()).toBeNull();
    expect(getStore()).toBeInstanceOf(MemoryStore);
  });

  it('fails clearly in production without credentials', () => {
    vi.stubEnv('DEV', false);
    expect(() => getStore()).toThrow(/Upstash/);
  });
});
