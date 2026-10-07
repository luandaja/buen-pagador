// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMG } from '../src/lib/http';
import { resetStore } from '../src/lib/store';
import { callApi } from './helpers/api';

beforeEach(() => {
  resetStore();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const create = async (body: unknown = { img: 'aW1n', state: 'c3Q' }) =>
  callApi('/api/share', { method: 'POST', body: JSON.stringify(body) });

async function created() {
  const res = await create();
  return (await res.json()) as { id: string; token: string; v: number };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('POST /api/share', () => {
  it('crea un link con id y token', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: expect.stringMatching(/^[A-Za-z0-9]{10}$/), v: 1 });
  });

  it('rechaza datos inválidos o demasiado grandes', async () => {
    expect((await create({ img: 'no válido!', state: 'x' })).status).toBe(400);
    expect((await create({ img: 'a'.repeat(MAX_IMG + 70_000), state: 'x' })).status).toBe(413);
  });
});

describe('GET /api/share/:id', () => {
  it('devuelve solo el estado por defecto y la foto con ?img=1', async () => {
    const { id, token } = await created();
    expect(await (await callApi(`/api/share/${id}`)).json()).toEqual({ state: 'c3Q', v: 1 });
    expect(await (await callApi(`/api/share/${id}?img=1`)).json()).toEqual({ state: 'c3Q', v: 1, img: 'aW1n' });
    const withToken = await callApi(`/api/share/${id}`, { headers: auth(token) });
    expect(await withToken.json()).toMatchObject({ canEdit: true });
  });

  it('404 si no existe o el id es inválido', async () => {
    expect((await callApi('/api/share/AAAAAAAAAA')).status).toBe(404);
    expect((await callApi('/api/share/x')).status).toBe(404);
  });
});

describe('PUT /api/share/:id', () => {
  it('solo el token correcto puede editar', async () => {
    const { id, token } = await created();
    const put = (headers: Record<string, string>, body: unknown = { state: 'bnVldm8' }) =>
      callApi(`/api/share/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) });

    expect((await put({})).status).toBe(403);
    expect((await put(auth('falso'))).status).toBe(403);
    expect((await put(auth(token), { state: '!!' })).status).toBe(400);
    const ok = await put(auth(token));
    expect(await ok.json()).toEqual({ v: 2 });
    expect(await (await callApi(`/api/share/${id}`)).json()).toEqual({ state: 'bnVldm8', v: 2 });
  });

  it('404 si no existe o el id es inválido', async () => {
    expect((await callApi('/api/share/AAAAAAAAAA', { method: 'PUT' })).status).toBe(404);
    expect((await callApi('/api/share/x', { method: 'PUT' })).status).toBe(404);
  });
});

describe('DELETE /api/share/:id', () => {
  it('solo el token correcto puede borrar', async () => {
    const { id, token } = await created();
    expect((await callApi(`/api/share/${id}`, { method: 'DELETE' })).status).toBe(403);
    expect((await callApi(`/api/share/${id}`, { method: 'DELETE', headers: auth(token) })).status).toBe(200);
    expect((await callApi(`/api/share/${id}`)).status).toBe(404);
  });

  it('borrar algo que no existe es idempotente; un id inválido es 404', async () => {
    expect((await callApi('/api/share/AAAAAAAAAA', { method: 'DELETE' })).status).toBe(200);
    expect((await callApi('/api/share/x', { method: 'DELETE' })).status).toBe(404);
  });
});
