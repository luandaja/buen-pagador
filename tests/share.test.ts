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
  ShareError,
  toShared,
} from '../src/scripts/share';
import { defaultState, type State } from '../src/scripts/state';
import { useApiFetch } from './helpers/api';

vi.mock('../src/scripts/image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/scripts/image')>()),
  shareImageBytes: vi.fn(async () => new Uint8Array([255, 216, 255, 1, 2, 3])),
}));

const state: State = {
  ...defaultState(),
  image: 'data:image/jpeg;base64,AAAA',
  title: 'Jueves',
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

  it('arma y parsea el link público y el maestro', () => {
    expect(parsePublicHash(new URL(publicUrl(link)).hash)).toEqual({ id: link.id, key: link.key });
    expect(parseMasterHash(new URL(masterUrl(link)).hash)).toEqual(link);
  });

  it('rechaza hashes incompletos', () => {
    expect(parsePublicHash('#AbCdEfGhIj.corto')).toBeNull();
    expect(parseMasterHash('#editar=AbCdEfGhIj')).toBeNull();
  });

  it('comparte solo lo necesario y redondea coordenadas', () => {
    const shared = toShared(state);
    expect(shared).not.toHaveProperty('image');
    expect(shared).not.toHaveProperty('blocked');
    expect(shared.faces[0].x).toBe(0.1235);
  });
});

describe('ciclo completo contra la API', () => {
  it('crea, lee con foto, actualiza y borra', async () => {
    const link = await createShare(state);
    expect(link.key).toHaveLength(43);

    const first = await loadShare(link, true);
    expect(first).toMatchObject({ v: 1, canEdit: true, state: { title: 'Jueves', cost: 100 } });
    expect(first.image).toMatch(/^data:image\/jpeg;base64,/);

    expect(await pushShare(link, { ...state, title: 'Viernes' })).toBe(2);
    const publicView = await loadShare({ id: link.id, key: link.key }, false);
    expect(publicView).toMatchObject({ v: 2, state: { title: 'Viernes' } });
    expect(publicView.image).toBeUndefined();
    expect(publicView.canEdit).toBeUndefined();

    await deleteShare(link);
    await expect(loadShare(link, false)).rejects.toMatchObject({ status: 404 });
  });

  it('sin foto no se puede crear', async () => {
    await expect(createShare({ ...state, image: null })).rejects.toBeInstanceOf(ShareError);
  });

  it('con otra clave el link se reporta como dañado', async () => {
    const link = await createShare(state);
    await expect(loadShare({ ...link, key: 'A'.repeat(43) }, false)).rejects.toMatchObject({ status: 400 });
  });

  it('con un token ajeno no se puede editar', async () => {
    const link = await createShare(state);
    await expect(pushShare({ ...link, token: 'x'.repeat(32) }, state)).rejects.toMatchObject({ status: 403 });
  });

  it('si el servidor no responde JSON, da un mensaje genérico', async () => {
    globalThis.fetch = (async () => new Response('caído', { status: 500 })) as typeof fetch;
    await expect(loadShare({ id: 'AbCdEfGhIj', key: 'k' }, false)).rejects.toThrow('No se pudo conectar.');
  });
});
