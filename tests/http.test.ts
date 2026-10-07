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

describe('respuestas', () => {
  it('json sin caché', async () => {
    const res = json({ ok: 1 }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: 1 });
  });

  it('fail con mensaje', async () => {
    expect(await fail(400, 'mal').json()).toEqual({ error: 'mal' });
  });
});

describe('readJson', () => {
  it('lee objetos JSON', async () => {
    expect(await readJson(post('{"a":1}'), 100)).toEqual({ a: 1 });
  });

  it('rechaza cuerpos grandes por header o por contenido', async () => {
    expect(await readJson(post('{}', { 'content-length': '999' }), 10)).toBeNull();
    expect(await readJson(post('{"a":"0123456789"}'), 10)).toBeNull();
  });

  it('rechaza JSON inválido o que no es objeto', async () => {
    expect(await readJson(post('{roto'), 100)).toBeNull();
    expect(await readJson(post('3'), 100)).toBeNull();
    expect(await readJson(post('null'), 100)).toBeNull();
  });
});

describe('validaciones', () => {
  it('payload: base64url no vacío y dentro del límite', () => {
    expect(isPayload('abc_-9', 10)).toBe(true);
    expect(isPayload('', 10)).toBe(false);
    expect(isPayload('a+b', 10)).toBe(false);
    expect(isPayload('abcdef', 3)).toBe(false);
    expect(isPayload(42, 10)).toBe(false);
  });

  it('id de 10 caracteres alfanuméricos', () => {
    expect(isId(randomId())).toBe(true);
    expect(isId('corto')).toBe(false);
    expect(isId(undefined)).toBe(false);
  });

  it('token de 32 caracteres base64url', () => {
    expect(randomToken()).toMatch(/^[\w-]{32}$/);
  });
});

describe('permisos', () => {
  const withAuth = (value?: string) =>
    new Request('http://x', { headers: value ? { authorization: value } : {} });

  it('extrae el token Bearer', () => {
    expect(bearerToken(withAuth('Bearer  abc '))).toBe('abc');
    expect(bearerToken(withAuth('Basic abc'))).toBe('');
    expect(bearerToken(withAuth())).toBe('');
  });

  it('compara en tiempo constante', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
  });

  it('solo edita quien tiene el token correcto', async () => {
    const hash = await sha256('secreto');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await canEdit(withAuth('Bearer secreto'), hash)).toBe(true);
    expect(await canEdit(withAuth('Bearer otro'), hash)).toBe(false);
    expect(await canEdit(withAuth(), hash)).toBe(false);
    expect(await canEdit(withAuth('Bearer secreto'), undefined)).toBe(false);
  });
});
