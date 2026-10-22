import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore } from '../src/lib/store';
import {
  createShare,
  deleteShare,
  fromShared,
  loadShare,
  masterUrl,
  parseMasterHash,
  parsePublicHash,
  publicUrl,
  pushShare,
  hasPay,
  payOf,
  SCHEMA_VERSION,
  toShared,
} from '../src/scripts/share';
import { encryptJson, importKey } from '../src/scripts/crypto';
import { es } from '../src/i18n/es';
import { defaultState, type State } from '../src/scripts/state';
import { useApiFetch } from './helpers/api';

vi.mock('../src/scripts/image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/scripts/image')>()),
  shareImageBytes: vi.fn(async () => new Uint8Array([255, 216, 255, 1, 2, 3])),
}));

const state: State = {
  ...defaultState(),
  image: 'data:image/jpeg;base64,AAAA',
  title: 'Thursday',
  cost: 100,
  blocked: ['🐔'],
  faces: [{ id: 'a', x: 0.123456789, y: 0.2, w: 0.1, h: 0.1, emoji: '🐸', paid: true }],
};

beforeEach(() => {
  resetStore();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  useApiFetch();
});

describe('links', () => {
  const link = { id: 'AbCdEfGhIj', key: 'k'.repeat(43), token: 't'.repeat(32) };

  it('builds and parses the public and master links', () => {
    expect(parsePublicHash(new URL(publicUrl(link)).hash)).toEqual({ id: link.id, key: link.key });
    expect(parseMasterHash(new URL(masterUrl(link)).hash)).toEqual(link);
  });

  it('rejects incomplete hashes', () => {
    expect(parsePublicHash('#AbCdEfGhIj.corto')).toBeNull();
    expect(parseMasterHash('#editar=AbCdEfGhIj')).toBeNull();
  });

  it('shares only what is needed and rounds coordinates', () => {
    const shared = toShared(state);
    expect(shared).not.toHaveProperty('image');
    expect(shared).not.toHaveProperty('blocked');
    expect(shared.faces[0].x).toBe(0.1235);
  });

  it('stamps the schema version', () => {
    expect(toShared(state).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('shares a fixed quota as is, and only the share when the total is hidden', () => {
    expect(toShared({ ...state, quota: 12 })).toMatchObject({ cost: 100, quota: 12, hideTotal: false });
    expect(toShared({ ...state, hideTotal: true })).toMatchObject({ cost: null, quota: 100, hideTotal: true });
    expect(toShared({ ...state, quota: 12, hideTotal: true })).toMatchObject({ cost: null, quota: 12 });
  });

  it('takes the shared cost and quota unless they were hidden and this device knows its own', () => {
    const shared = { ...toShared({ ...state, hideTotal: true }), title: 'Friday' };
    expect(fromShared(shared, { cost: 100, quota: null })).not.toHaveProperty('cost');
    expect(fromShared(shared, { cost: 100, quota: null })).toMatchObject({ title: 'Friday', hideTotal: true });
    expect(fromShared(shared, { cost: null, quota: null })).toMatchObject({ cost: null, quota: 100 });
    expect(fromShared(toShared(state), { cost: 80, quota: 5 })).toMatchObject({ cost: 100, quota: null });
    expect(fromShared(toShared(state), { cost: 80, quota: 5 })).not.toHaveProperty('schemaVersion');
  });
});

describe('full cycle against the API', () => {
  it('creates, reads with photo, updates and deletes', async () => {
    const link = await createShare(state);
    expect(link.key).toHaveLength(43);

    expect(link.expiresAt).toBeGreaterThan(Date.now());
    const first = await loadShare(link, true);
    expect(first.expiresAt).toBeGreaterThan(Date.now());
    expect(first).toMatchObject({ v: 1, canEdit: true, state: { title: 'Thursday', cost: 100 } });
    expect(first.image).toMatch(/^data:image\/jpeg;base64,/);

    expect(await pushShare(link, { ...state, title: 'Friday' })).toEqual({ v: 2, expiresAt: expect.any(Number) });
    const publicView = await loadShare({ id: link.id, key: link.key }, false);
    expect(publicView).toMatchObject({ v: 2, state: { title: 'Friday' } });
    expect(publicView.image).toBeUndefined();
    expect(publicView.canEdit).toBeUndefined();

    await deleteShare(link);
    await expect(loadShare(link, false)).rejects.toMatchObject({ status: 404 });
  });

  it('reads links created before schemaVersion existed as version 1', async () => {
    const link = await createShare(state);
    const { schemaVersion, ...legacy } = toShared(state);
    const response = await fetch(`/api/share/${link.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${link.token}` },
      body: JSON.stringify({ state: await encryptJson(await importKey(link.key), legacy) }),
    });
    expect(response.ok).toBe(true);
    expect((await loadShare(link, false)).state.schemaVersion).toBe(schemaVersion);
  });

  it('payment details travel encrypted and separately', async () => {
    const withPay = { ...state, payNote: ' Wallet 987 ', payQr: 'data:image/jpeg;base64,QR' };
    expect(payOf(withPay)).toEqual({ note: 'Wallet 987', qr: 'data:image/jpeg;base64,QR' });
    expect(hasPay({ note: '', qr: null })).toBe(false);

    const link = await createShare(withPay);
    expect(await loadShare(link, false)).toMatchObject({ pv: 1 });
    expect((await loadShare(link, false)).pay).toBeUndefined();
    expect((await loadShare(link, false, true)).pay).toEqual({ note: 'Wallet 987', qr: 'data:image/jpeg;base64,QR' });

    await pushShare(link, { ...withPay, payNote: 'Wallet 123' }, true);
    expect(await loadShare(link, false, true)).toMatchObject({ pv: 2, pay: { note: 'Wallet 123' } });
    await pushShare(link, withPay);
    expect((await loadShare(link, false)).pv).toBe(2);
  });

  it('creates a link without a photo', async () => {
    const link = await createShare({ ...state, image: null });
    const loaded = await loadShare(link, true);
    expect(loaded.image).toBeUndefined();
    expect(loaded.state.faces).toHaveLength(1);
  });

  it('a hidden total never reaches the link, only the share', async () => {
    const hidden = { ...state, cost: 100, faces: [...state.faces, { ...state.faces[0], id: 'b', paid: false }], hideTotal: true };
    const link = await createShare(hidden);
    expect((await loadShare(link, false)).state).toMatchObject({ cost: null, quota: 50, hideTotal: true });
  });

  it('a different key reports the link as broken', async () => {
    const link = await createShare(state);
    await expect(loadShare({ ...link, key: 'A'.repeat(43) }, false)).rejects.toMatchObject({ status: 400 });
  });

  it('a foreign token cannot edit', async () => {
    const link = await createShare(state);
    await expect(pushShare({ ...link, token: 'x'.repeat(32) }, state)).rejects.toMatchObject({ status: 403 });
  });

  it('falls back to a generic message when the server does not reply with JSON', async () => {
    globalThis.fetch = (async () => new Response('down', { status: 500 })) as typeof fetch;
    await expect(loadShare({ id: 'AbCdEfGhIj', key: 'k' }, false)).rejects.toThrow(es.errors.network);
  });
});
