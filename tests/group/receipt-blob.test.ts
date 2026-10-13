// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGroupStore, GROUP_TTL_SECONDS, MemoryGroupStore, RedisGroupStore, resetGroupStore } from '../../src/lib/group-store';
import { getReceiptStore, MAX_RECEIPT, MemoryReceiptStore, receiptPath, resetReceiptStore, VercelBlobReceiptStore } from '../../src/lib/receipt-store';
import { sweepReceipts } from '../../src/lib/receipt-sweep';
import { callApi } from '../helpers/api';

const blob = vi.hoisted(() => ({
  put: vi.fn(async () => ({})),
  get: vi.fn(),
  del: vi.fn(async () => undefined),
  list: vi.fn(),
}));
vi.mock('@vercel/blob', () => blob);

beforeEach(() => {
  resetGroupStore();
  resetReceiptStore();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const send = (path: string, method: string, body?: unknown, token?: string) =>
  callApi(path, {
    method,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

async function created() {
  const response = await send('/api/group', 'POST', { fields: { m: 'bWV0YQ' } });
  return (await response.json()) as { id: string; token: string };
}

describe('/api/group/:id/receipt/:expense', () => {
  it('stores, serves and deletes an encrypted receipt for editors only', async () => {
    const { id, token } = await created();
    const url = `/api/group/${id}/receipt/hotel1`;
    expect((await send(url, 'GET')).status).toBe(404);
    expect((await send(url, 'PUT', { data: 'Y2lwaGVy' })).status).toBe(403);
    expect((await send(url, 'PUT', { data: 'Y2lwaGVy' }, 'wrong')).status).toBe(403);
    expect((await send(url, 'PUT', { data: 'not base64!' }, token)).status).toBe(400);
    expect((await send(url, 'PUT', { data: 'a'.repeat(MAX_RECEIPT + 1) }, token)).status).toBe(400);
    expect((await send(url, 'PUT', { data: 'Y2lwaGVy' }, token)).status).toBe(200);

    const served = await send(url, 'GET');
    expect(served.status).toBe(200);
    expect(await served.json()).toEqual({ data: 'Y2lwaGVy' });
    expect(await getGroupStore().dueReceipts(Date.now() + GROUP_TTL_SECONDS * 1000, 10)).toEqual([id]);

    expect((await send(url, 'DELETE')).status).toBe(403);
    expect((await send(url, 'DELETE', undefined, token)).status).toBe(200);
    expect((await send(url, 'GET')).status).toBe(404);
  });

  it('rejects bad ids and unknown groups', async () => {
    expect((await send('/api/group/short/receipt/x1', 'GET')).status).toBe(404);
    expect((await send('/api/group/AbCdEfGhIj/receipt/NO_UPPER', 'GET')).status).toBe(404);
    expect((await send('/api/group/AbCdEfGhIj/receipt/x1', 'GET')).status).toBe(404);
    expect((await send('/api/group/AbCdEfGhIj/receipt/x1', 'PUT', { data: 'YQ' }, 'tok')).status).toBe(404);
    expect((await send('/api/group/short/receipt/x1', 'DELETE')).status).toBe(404);
  });

  it('stops serving photos when the group link is turned off', async () => {
    const { id, token } = await created();
    await send(`/api/group/${id}/receipt/a1`, 'PUT', { data: 'YQ' }, token);
    expect((await send(`/api/group/${id}`, 'DELETE', undefined, token)).status).toBe(200);
    expect(await new MemoryReceiptStore().get(receiptPath(id, 'a1'))).toBeNull();
    expect((await send(`/api/group/${id}/receipt/a1`, 'GET')).status).toBe(404);
  });

  it('answers 503 when Blob is not configured or failing, without breaking the group', async () => {
    const { id, token } = await created();
    const url = `/api/group/${id}/receipt/a1`;
    vi.spyOn(MemoryReceiptStore.prototype, 'put').mockRejectedValueOnce(new Error('quota'));
    expect((await send(url, 'PUT', { data: 'YQ' }, token)).status).toBe(503);
    vi.spyOn(MemoryReceiptStore.prototype, 'get').mockRejectedValueOnce(new Error('down'));
    expect((await send(url, 'GET')).status).toBe(503);
    vi.spyOn(MemoryReceiptStore.prototype, 'remove').mockRejectedValueOnce(new Error('down'));
    expect((await send(url, 'DELETE', undefined, token)).status).toBe(200);

    resetReceiptStore();
    vi.stubEnv('DEV', false);
    expect(getReceiptStore()).toBeNull();
    expect((await send(url, 'GET')).status).toBe(503);
    expect((await send(url, 'PUT', { data: 'YQ' }, token)).status).toBe(503);
    expect((await send(url, 'DELETE', undefined, token)).status).toBe(200);
    expect((await send(`/api/group/${id}`, 'DELETE', undefined, token)).status).toBe(200);
  });
});

describe('receipt cleanup', () => {
  it('deletes the photos of expired groups and renews the ones still alive', async () => {
    const groups = new MemoryGroupStore();
    const receipts = new MemoryReceiptStore();
    await groups.create('alive', 'hash', { m: 'meta' });
    await groups.trackReceipts('alive', 1);
    await groups.trackReceipts('gone', 2);
    await groups.trackReceipts('later', Date.now() + 1_000_000);
    await receipts.put(receiptPath('gone', 'a1'), 'x');
    await receipts.put(receiptPath('gone', 'b2'), 'y');
    await receipts.put(receiptPath('alive', 'a1'), 'z');

    expect(await sweepReceipts(groups, receipts)).toEqual({ removed: 1, renewed: 1 });
    expect(await receipts.get(receiptPath('gone', 'a1'))).toBeNull();
    expect(await receipts.get(receiptPath('alive', 'a1'))).toBe('z');
    expect(await groups.dueReceipts(Date.now(), 10)).toEqual([]);
    expect(await groups.dueReceipts(Date.now() + GROUP_TTL_SECONDS * 1000, 10)).toEqual(['later', 'alive']);
  });

  it('runs from the cron endpoint only with the secret', async () => {
    expect((await send('/api/cron/receipts', 'GET')).status).toBe(401);
    vi.stubEnv('CRON_SECRET', 'shh');
    expect((await send('/api/cron/receipts', 'GET', undefined, 'nope')).status).toBe(401);
    await getGroupStore().trackReceipts('expired', 1);
    const swept = await send('/api/cron/receipts', 'GET', undefined, 'shh');
    expect(await swept.json()).toEqual({ removed: 1, renewed: 0 });

    resetReceiptStore();
    vi.stubEnv('DEV', false);
    expect(await (await send('/api/cron/receipts', 'GET', undefined, 'shh')).json()).toEqual({ removed: 0, renewed: 0 });
  });
});

describe('VercelBlobReceiptStore', () => {
  it('uses private blobs at a fixed path and deletes folders page by page', async () => {
    const store = new VercelBlobReceiptStore();
    await store.put('receipts/g/a.txt', 'cipher');
    expect(blob.put).toHaveBeenCalledWith('receipts/g/a.txt', 'cipher', expect.objectContaining({ access: 'private', allowOverwrite: true, addRandomSuffix: false }));

    blob.get.mockResolvedValueOnce({ statusCode: 200, stream: new Response('cipher').body });
    expect(await store.get('receipts/g/a.txt')).toBe('cipher');
    blob.get.mockResolvedValueOnce(null);
    expect(await store.get('receipts/g/b.txt')).toBeNull();

    await store.remove('receipts/g/a.txt');
    expect(blob.del).toHaveBeenLastCalledWith('receipts/g/a.txt');

    blob.list
      .mockResolvedValueOnce({ blobs: [{ url: 'u1' }, { url: 'u2' }], hasMore: true, cursor: 'c' })
      .mockResolvedValueOnce({ blobs: [], hasMore: false });
    await store.removeFolder('receipts/g/');
    expect(blob.list).toHaveBeenLastCalledWith({ prefix: 'receipts/g/', cursor: 'c' });
    expect(blob.del).toHaveBeenLastCalledWith(['u1', 'u2']);
  });

  it('is picked when the Blob token or store id is set', () => {
    expect(getReceiptStore()).toBeInstanceOf(MemoryReceiptStore);
    resetReceiptStore();
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_x');
    expect(getReceiptStore()).toBeInstanceOf(VercelBlobReceiptStore);
    expect(getReceiptStore()).toBe(getReceiptStore());
  });
});

describe('RedisGroupStore receipt index', () => {
  it('keeps due dates in a sorted set', async () => {
    const redis = { zadd: vi.fn(), zrem: vi.fn(), zrange: vi.fn(async () => ['g1', 'g2']) };
    const store = new RedisGroupStore(redis as never);
    await store.trackReceipts('g1', 123);
    expect(redis.zadd).toHaveBeenCalledWith('bp:receipts:due', { score: 123, member: 'g1' });
    await store.trackReceipts('g2');
    expect(redis.zadd).toHaveBeenLastCalledWith('bp:receipts:due', { score: expect.any(Number), member: 'g2' });
    expect(await store.dueReceipts(500, 10)).toEqual(['g1', 'g2']);
    expect(redis.zrange).toHaveBeenCalledWith('bp:receipts:due', 0, 500, { byScore: true, offset: 0, count: 10 });
    await store.untrackReceipts('g1');
    expect(redis.zrem).toHaveBeenCalledWith('bp:receipts:due', 'g1');
  });
});
