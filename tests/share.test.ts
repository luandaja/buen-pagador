import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore } from '../src/lib/store';
import {
  createShare,
  deleteShare,
  loadShare,
  masterUrl,
  parseMasterHash,
  parsePublicHash,
  publicUrl,
  pushShare,
  hasPay,
  payOf,
  ShareError,
  toShared,
} from '../src/scripts/share';
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
});

describe('full cycle against the API', () => {
  it('creates, reads with photo, updates and deletes', async () => {
    const link = await createShare(state);
    expect(link.key).toHaveLength(43);

    const first = await loadShare(link, true);
    expect(first).toMatchObject({ v: 1, canEdit: true, state: { title: 'Thursday', cost: 100 } });
    expect(first.image).toMatch(/^data:image\/jpeg;base64,/);

    expect(await pushShare(link, { ...state, title: 'Friday' })).toBe(2);
    const publicView = await loadShare({ id: link.id, key: link.key }, false);
    expect(publicView).toMatchObject({ v: 2, state: { title: 'Friday' } });
    expect(publicView.image).toBeUndefined();
    expect(publicView.canEdit).toBeUndefined();

    await deleteShare(link);
    await expect(loadShare(link, false)).rejects.toMatchObject({ status: 404 });
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

  it('cannot create without a photo', async () => {
    await expect(createShare({ ...state, image: null })).rejects.toBeInstanceOf(ShareError);
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
