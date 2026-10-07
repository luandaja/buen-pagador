// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMG, MAX_PAY } from '../src/lib/http';
import { resetStore } from '../src/lib/store';
import { callApi } from './helpers/api';

beforeEach(() => {
  resetStore();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const create = async (body: unknown = { img: 'aW1n', state: 'c3Q' }) =>
  callApi('/api/share', { method: 'POST', body: JSON.stringify(body) });

async function created() {
  const response = await create();
  return (await response.json()) as { id: string; token: string; v: number };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('POST /api/share', () => {
  it('creates a link with id and token', async () => {
    const response = await create();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: expect.stringMatching(/^[A-Za-z0-9]{10}$/), v: 1 });
  });

  it('rejects invalid or oversized data', async () => {
    expect((await create({ img: 'not valid!', state: 'x' })).status).toBe(400);
    expect((await create({ img: 'a'.repeat(MAX_IMG + MAX_PAY + 70_000), state: 'x' })).status).toBe(413);
    expect((await create({ img: 'a'.repeat(MAX_IMG + 10), state: 'x' })).status).toBe(400);
  });
});

describe('GET /api/share/:id', () => {
  it('returns only the state by default and the photo with ?img=1', async () => {
    const { id, token } = await created();
    expect(await (await callApi(`/api/share/${id}`)).json()).toEqual({ state: 'c3Q', v: 1, pv: 0 });
    expect(await (await callApi(`/api/share/${id}?img=1`)).json()).toEqual({ state: 'c3Q', v: 1, pv: 0, img: 'aW1n' });
    const withToken = await callApi(`/api/share/${id}`, { headers: auth(token) });
    expect(await withToken.json()).toMatchObject({ canEdit: true });
  });

  it('404 when missing or the id is invalid', async () => {
    expect((await callApi('/api/share/AAAAAAAAAA')).status).toBe(404);
    expect((await callApi('/api/share/x')).status).toBe(404);
  });
});

describe('PUT /api/share/:id', () => {
  it('only the right token can edit', async () => {
    const { id, token } = await created();
    const put = (headers: Record<string, string>, body: unknown = { state: 'bmV4dA' }) =>
      callApi(`/api/share/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) });

    expect((await put({})).status).toBe(403);
    expect((await put(auth('falso'))).status).toBe(403);
    expect((await put(auth(token), { state: '!!' })).status).toBe(400);
    const updated = await put(auth(token));
    expect(await updated.json()).toEqual({ v: 2 });
    expect(await (await callApi(`/api/share/${id}`)).json()).toEqual({ state: 'bmV4dA', v: 2, pv: 0 });
  });

  it('404 when missing or the id is invalid', async () => {
    expect((await callApi('/api/share/AAAAAAAAAA', { method: 'PUT' })).status).toBe(404);
    expect((await callApi('/api/share/x', { method: 'PUT' })).status).toBe(404);
  });
});

describe('payment details', () => {
  it('are stored separately, versioned, and only sent on request', async () => {
    const response = await create({ img: 'aW1n', state: 'c3Q', pay: 'cGF5' });
    const { id, token } = (await response.json()) as { id: string; token: string };
    expect(await (await callApi(`/api/share/${id}`)).json()).toEqual({ state: 'c3Q', v: 1, pv: 1 });
    expect(await (await callApi(`/api/share/${id}?pay=1`)).json()).toEqual({ state: 'c3Q', v: 1, pv: 1, pay: 'cGF5' });
    expect(await (await callApi(`/api/share/${id}?img=1`)).json()).toMatchObject({ img: 'aW1n', pay: 'cGF5' });

    const put = (body: unknown) => callApi(`/api/share/${id}`, { method: 'PUT', headers: auth(token), body: JSON.stringify(body) });
    expect(await (await put({ state: 'MQ' })).json()).toEqual({ v: 2 });
    expect(await (await callApi(`/api/share/${id}`)).json()).toMatchObject({ v: 2, pv: 1 });
    expect(await (await put({ state: 'Mg', pay: 'bmV4dA' })).json()).toEqual({ v: 3 });
    expect(await (await callApi(`/api/share/${id}?pay=1`)).json()).toMatchObject({ v: 3, pv: 2, pay: 'bmV4dA' });
    expect((await put({ state: 'Mg', pay: '!!' })).status).toBe(400);
  });

  it('without payment details the version is 0 and there is no pay field', async () => {
    const { id } = await created();
    expect(await (await callApi(`/api/share/${id}?pay=1`)).json()).toEqual({ state: 'c3Q', v: 1, pv: 0 });
    expect((await create({ img: 'aW1n', state: 'c3Q', pay: 'not valid!' })).status).toBe(400);
  });
});

describe('DELETE /api/share/:id', () => {
  it('only the right token can delete', async () => {
    const { id, token } = await created();
    expect((await callApi(`/api/share/${id}`, { method: 'DELETE' })).status).toBe(403);
    expect((await callApi(`/api/share/${id}`, { method: 'DELETE', headers: auth(token) })).status).toBe(200);
    expect((await callApi(`/api/share/${id}`)).status).toBe(404);
  });

  it('deleting something missing is idempotent; an invalid id is 404', async () => {
    expect((await callApi('/api/share/AAAAAAAAAA', { method: 'DELETE' })).status).toBe(200);
    expect((await callApi('/api/share/x', { method: 'DELETE' })).status).toBe(404);
  });
});
