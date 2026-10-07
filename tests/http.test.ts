// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  bearerToken,
  canEdit,
  fail,
  isId,
  isPayload,
  json,
  randomId,
  randomToken,
  readJson,
  safeEqual,
  sha256,
} from '../src/lib/http';

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('http://x/api', { method: 'POST', body, headers });

describe('responses', () => {
  it('json is not cached', async () => {
    const res = json({ ok: 1 }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: 1 });
  });

  it('fail carries an error code', async () => {
    expect(await fail(400, 'invalid').json()).toEqual({ error: 'invalid' });
  });
});

describe('readJson', () => {
  it('reads JSON objects', async () => {
    expect(await readJson(post('{"a":1}'), 100)).toEqual({ a: 1 });
  });

  it('rejects large bodies by header or content', async () => {
    expect(await readJson(post('{}', { 'content-length': '999' }), 10)).toBeNull();
    expect(await readJson(post('{"a":"0123456789"}'), 10)).toBeNull();
  });

  it('rejects invalid JSON and non-objects', async () => {
    expect(await readJson(post('{broken'), 100)).toBeNull();
    expect(await readJson(post('3'), 100)).toBeNull();
    expect(await readJson(post('null'), 100)).toBeNull();
  });
});

describe('validation', () => {
  it('payload: non-empty base64url within the limit', () => {
    expect(isPayload('abc_-9', 10)).toBe(true);
    expect(isPayload('', 10)).toBe(false);
    expect(isPayload('a+b', 10)).toBe(false);
    expect(isPayload('abcdef', 3)).toBe(false);
    expect(isPayload(42, 10)).toBe(false);
  });

  it('id is 10 alphanumeric characters', () => {
    expect(isId(randomId())).toBe(true);
    expect(isId('short')).toBe(false);
    expect(isId(undefined)).toBe(false);
  });

  it('token is 32 base64url characters', () => {
    expect(randomToken()).toMatch(/^[\w-]{32}$/);
  });
});

describe('permissions', () => {
  const withAuth = (value?: string) =>
    new Request('http://x', { headers: value ? { authorization: value } : {} });

  it('extracts the Bearer token', () => {
    expect(bearerToken(withAuth('Bearer  abc '))).toBe('abc');
    expect(bearerToken(withAuth('Basic abc'))).toBe('');
    expect(bearerToken(withAuth())).toBe('');
  });

  it('compares in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
  });

  it('only the right token can edit', async () => {
    const hash = await sha256('secret');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await canEdit(withAuth('Bearer secret'), hash)).toBe(true);
    expect(await canEdit(withAuth('Bearer other'), hash)).toBe(false);
    expect(await canEdit(withAuth(), hash)).toBe(false);
    expect(await canEdit(withAuth('Bearer secret'), undefined)).toBe(false);
  });
});
