// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentials, getStore, MemoryStore, RedisStore, resetStore, TTL_SECONDS, type ShareRecord } from '../src/lib/store';

const record: ShareRecord = { img: 'img', state: 'st', edit: 'hash', v: 1 };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  resetStore();
});

describe('MemoryStore', () => {
  it('crea, lee campos, actualiza y borra', async () => {
    const store = new MemoryStore();
    await store.create('abc', record);
    expect(await store.get('abc', ['state', 'v'])).toEqual({ state: 'st', v: 1 });
    expect(await store.updateState('abc', 'st2')).toBe(2);
    expect(await store.get('abc', ['state', 'v', 'img'])).toEqual({ state: 'st2', v: 2, img: 'img' });
    await store.remove('abc');
    expect(await store.get('abc', ['state'])).toBeNull();
    expect(await store.updateState('abc', 'x')).toBe(0);
  });

  it('expira a los 30 días', async () => {
    vi.useFakeTimers();
    const store = new MemoryStore();
    await store.create('exp', record);
    vi.advanceTimersByTime(TTL_SECONDS * 1000 + 1);
    expect(await store.get('exp', ['state'])).toBeNull();
  });
});

describe('RedisStore', () => {
  function fakeRedis(hmget: unknown) {
    const tx = { hset: vi.fn(), expire: vi.fn(), hincrby: vi.fn(), exec: vi.fn(async () => [1, 7, 1]) };
    const redis = { hmget: vi.fn(async () => hmget), multi: vi.fn(() => tx), del: vi.fn() };
    return { redis, tx, store: new RedisStore(redis as never) };
  }

  it('lee campos y convierte la versión a número', async () => {
    const { store, redis } = fakeRedis({ state: 's', v: '3' });
    expect(await store.get('id', ['state', 'v'])).toEqual({ state: 's', v: 3 });
    expect(redis.hmget).toHaveBeenCalledWith('bp:share:id', 'state', 'v');
  });

  it('devuelve null si no existe', async () => {
    expect(await fakeRedis(null).store.get('id', ['state'])).toBeNull();
    expect(await fakeRedis({ state: null }).store.get('id', ['state'])).toBeNull();
  });

  it('crea con expiración y actualiza subiendo la versión', async () => {
    const { store, tx, redis } = fakeRedis(null);
    await store.create('id', record);
    expect(tx.hset).toHaveBeenCalledWith('bp:share:id', { ...record, v: '1' });
    expect(tx.expire).toHaveBeenCalledWith('bp:share:id', TTL_SECONDS);
    expect(await store.updateState('id', 'nuevo')).toBe(7);
    expect(tx.hincrby).toHaveBeenCalledWith('bp:share:id', 'v', 1);
    await store.remove('id');
    expect(redis.del).toHaveBeenCalledWith('bp:share:id');
  });
});

describe('getStore', () => {
  it('lee las credenciales de Vercel o de Upstash', () => {
    vi.stubEnv('KV_REST_API_URL', '');
    vi.stubEnv('KV_REST_API_TOKEN', '');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://u');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 't');
    expect(credentials()).toEqual({ url: 'https://u', token: 't' });
  });

  it('usa Redis si hay credenciales', () => {
    vi.stubEnv('KV_REST_API_URL', 'https://kv');
    vi.stubEnv('KV_REST_API_TOKEN', 'tok');
    expect(getStore()).toBeInstanceOf(RedisStore);
    expect(getStore()).toBe(getStore());
  });

  it('en desarrollo sin credenciales usa memoria', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(credentials()).toBeNull();
    expect(getStore()).toBeInstanceOf(MemoryStore);
  });

  it('en producción sin credenciales falla con un mensaje claro', () => {
    vi.stubEnv('DEV', false);
    expect(() => getStore()).toThrow(/Upstash/);
  });
});
