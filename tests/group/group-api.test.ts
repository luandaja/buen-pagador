// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_FIELD } from '../../src/lib/group-http';
import { GROUP_TTL_SECONDS, resetGroupStore } from '../../src/lib/group-store';
import { callApi } from '../helpers/api';

beforeEach(() => resetGroupStore());

const send = (path: string, method: string, body: unknown, token?: string) =>
  callApi(path, {
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

async function created() {
  const response = await send('/api/group', 'POST', { fields: { m: 'bWV0YQ', 'p:ana1': 'YW5h' } });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; token: string; v: number };
}

describe('POST /api/group', () => {
  it('creates a group with id and edit token', async () => {
    const { id, token, v } = await created();
    expect(id).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(token).toHaveLength(32);
    expect(v).toBe(1);
  });

  it('rejects groups without meta, bad names, bad payloads or oversized bodies', async () => {
    expect((await send('/api/group', 'POST', { fields: { 'p:a': 'YQ' } })).status).toBe(400);
    expect((await send('/api/group', 'POST', { fields: { m: 'YQ', _edit: 'YQ' } })).status).toBe(400);
    expect((await send('/api/group', 'POST', { fields: { m: 'not base64!' } })).status).toBe(400);
    expect((await send('/api/group', 'POST', { fields: { m: 'a'.repeat(MAX_FIELD + 1) } })).status).toBe(400);
    expect((await send('/api/group', 'POST', { fields: ['m'] })).status).toBe(400);
    expect((await send('/api/group', 'POST', 'x'.repeat(5_000_000))).status).toBe(413);
  });
});

describe('GET /api/group/:id', () => {
  it('returns the fields, tells editors apart and skips unchanged versions', async () => {
    const { id, token } = await created();
    expect(await (await callApi(`/api/group/${id}`)).json()).toEqual({ fields: { m: 'bWV0YQ', 'p:ana1': 'YW5h' }, v: 1, ttl: GROUP_TTL_SECONDS });
    expect(await (await send(`/api/group/${id}`, 'GET', undefined, token)).json()).toMatchObject({ canEdit: true });
    expect(await (await send(`/api/group/${id}`, 'GET', undefined, 'wrong')).json()).toMatchObject({ canEdit: false });
    expect(await (await callApi(`/api/group/${id}?since=1`)).json()).toEqual({ v: 1, unchanged: true, ttl: GROUP_TTL_SECONDS });
    expect(await (await callApi(`/api/group/${id}?since=7`)).json()).toMatchObject({ v: 1, fields: {} });
  });

  it('answers 404 for unknown or malformed ids', async () => {
    expect((await callApi('/api/group/AAAAAAAAAA')).status).toBe(404);
    expect((await callApi('/api/group/bad')).status).toBe(404);
  });
});

describe('PATCH /api/group/:id', () => {
  it('sets and deletes fields for editors only', async () => {
    const { id, token } = await created();
    expect((await send(`/api/group/${id}`, 'PATCH', { set: { 'e:taxi1': 'dGF4aQ' } })).status).toBe(403);
    const patched = await send(`/api/group/${id}`, 'PATCH', { set: { 'e:taxi1': 'dGF4aQ' }, del: ['p:ana1'] }, token);
    expect(await patched.json()).toEqual({ v: 2, ttl: GROUP_TTL_SECONDS });
    expect((await (await callApi(`/api/group/${id}`)).json()).fields).toEqual({ m: 'bWV0YQ', 'e:taxi1': 'dGF4aQ' });
    expect(await (await send(`/api/group/${id}`, 'PATCH', { del: ['e:taxi1'] }, token)).json()).toEqual({ v: 3, ttl: GROUP_TTL_SECONDS });
  });

  it('rejects invalid patches, deleting the meta and unknown groups', async () => {
    const { id, token } = await created();
    expect((await send(`/api/group/${id}`, 'PATCH', { del: ['m'] }, token)).status).toBe(400);
    expect((await send(`/api/group/${id}`, 'PATCH', { del: 'p:ana1' }, token)).status).toBe(400);
    expect((await send(`/api/group/${id}`, 'PATCH', { set: { 'x:1': 'YQ' } }, token)).status).toBe(400);
    expect((await send(`/api/group/${id}`, 'PATCH', 'not json', token)).status).toBe(400);
    expect((await send('/api/group/AAAAAAAAAA', 'PATCH', {}, token)).status).toBe(404);
    expect((await send('/api/group/bad', 'PATCH', {}, token)).status).toBe(404);
  });
});

describe('DELETE /api/group/:id', () => {
  it('lets only editors delete and is idempotent', async () => {
    const { id, token } = await created();
    expect((await send(`/api/group/${id}`, 'DELETE', undefined)).status).toBe(403);
    expect((await send(`/api/group/${id}`, 'DELETE', undefined, token)).status).toBe(200);
    expect((await callApi(`/api/group/${id}`)).status).toBe(404);
    expect((await send(`/api/group/${id}`, 'DELETE', undefined, token)).status).toBe(200);
    expect((await send('/api/group/bad', 'DELETE', undefined, token)).status).toBe(404);
  });
});
