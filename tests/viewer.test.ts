// @vitest-environment node
// Integración de la vista pública (/ver): HTML real + API real en proceso.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore } from '../src/lib/store';
import Ver from '../src/pages/ver.astro';
import { createShare, deleteShare, pushShare, type ShareLink } from '../src/scripts/share';
import { defaultState, type State } from '../src/scripts/state';
import { useApiFetch } from './helpers/api';
import { $, click, eventually, mount, renderPage, unmount } from './helpers/dom';

const mocks = vi.hoisted(() => ({ renderCard: vi.fn() }));

vi.mock('../src/scripts/export', () => ({ renderCard: mocks.renderCard }));
vi.mock('../src/scripts/image', () => ({
  canvasToBlob: vi.fn(async () => new Blob(['png'])),
  shareImageBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  bytesToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
}));

const ORIGIN = 'http://localhost:4321';
let html = '';

const game: State = {
  ...defaultState(),
  image: 'data:image/jpeg;base64,AAAA',
  title: 'Jueves',
  cost: 60,
  faces: [
    { id: 'a', x: 0.1, y: 0.1, w: 0.1, h: 0.1, emoji: '🐸', paid: true },
    { id: 'b', x: 0.4, y: 0.1, w: 0.1, h: 0.1, emoji: '🦊', paid: false },
  ],
};

beforeAll(async () => {
  html = await renderPage(Ver);
});

beforeEach(() => {
  resetStore();
  mocks.renderCard.mockReset().mockImplementation(async () => ({}));
});

afterEach(async () => {
  await unmount();
});

/** Abre la vista de un partido con datos para pagar. */
async function openWith(extra: Partial<State>) {
  return open(undefined, extra);
}

/** Crea un link con la API (con el DOM de la página ya montado) y abre la vista. */
async function open(hash?: (link: ShareLink) => string, extra: Partial<State> = {}) {
  mount(html, `${ORIGIN}/ver`);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useApiFetch();
  HTMLAnchorElement.prototype.click = vi.fn();
  const link = await createShare({ ...game, ...extra });
  location.hash = hash ? hash(link) : `#${link.id}.${link.key}`;
  vi.resetModules();
  await import('../src/scripts/viewer');
  return link;
}

const text = (id: string) => $(id).textContent;
const faces = () => [...document.querySelectorAll<HTMLElement>('.face')];

describe('vista pública', () => {
  it('muestra la foto, quién pagó y el avance, sin poder editar', async () => {
    await open();
    await eventually(() => expect($('panel').hidden).toBe(false));
    expect(text('viewTitle')).toBe('Jueves');
    expect(document.title).toBe('Jueves · El Buen Pagador');
    expect(text('paidOut')).toBe('1/2');
    expect(text('shareOut')).toBe('S/ 30');
    expect(faces().map((f) => f.tagName)).toEqual(['SPAN', 'SPAN']);
    expect(text('updated')).toMatch(/Revisado a las/);

    click(faces()[1]);
    expect(text('paidOut')).toBe('1/2');
  });

  it('se actualiza al volver a la pestaña', async () => {
    const link = await open();
    await eventually(() => expect(text('paidOut')).toBe('1/2'));
    await pushShare(link, { ...game, title: '', faces: game.faces.map((f) => ({ ...f, paid: true })) });
    document.dispatchEvent(new Event('visibilitychange'));
    await eventually(() => expect(text('paidOut')).toBe('2/2'));
    expect(text('viewTitle')).toBe('La cancha');
  });

  it('avisa cuando el link se borra', async () => {
    const link = await open();
    await eventually(() => expect($('panel').hidden).toBe(false));
    await deleteShare(link);
    document.dispatchEvent(new Event('visibilitychange'));
    await eventually(() => expect(text('viewerStateTitle')).toBe('Este link ya no existe'));
    expect($('panel').hidden).toBe(true);
  });

  it('sin red mantiene lo último que mostró', async () => {
    await open();
    await eventually(() => expect($('panel').hidden).toBe(false));
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 20));
    expect($('panel').hidden).toBe(false);
  });

  it('link incompleto o con otra clave', async () => {
    await open(() => '');
    expect(text('viewerStateTitle')).toBe('Link incompleto');

    await unmount();
    await open((link) => `#${link.id}.${'A'.repeat(43)}`);
    await eventually(() => expect(text('viewerStateTitle')).toBe('Link incompleto'));
  });

  it('cambiar el hash abre otro link', async () => {
    const first = await open();
    await eventually(() => expect(text('viewTitle')).toBe('Jueves'));
    const second = await createShare({ ...game, title: 'Viernes' });
    expect(second.id).not.toBe(first.id);
    location.hash = `#${second.id}.${second.key}`;
    window.dispatchEvent(new Event('hashchange'));
    await eventually(() => expect(text('viewTitle')).toBe('Viernes'));
  });

  it('descarga la imagen y avisa si falla', async () => {
    await open();
    await eventually(() => expect($('panel').hidden).toBe(false));
    click($('download'));
    await eventually(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
    expect(mocks.renderCard).toHaveBeenCalledWith(expect.objectContaining({ title: 'Jueves', includePhoto: true }));

    mocks.renderCard.mockRejectedValueOnce(new Error('canvas'));
    click($('download'));
    await eventually(() => expect(text('exportMsg')).toMatch(/No se pudo generar/));
  });
});

describe('cómo pagar', () => {
  it('muestra la nota y el QR, y los copia o guarda', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('no'));
    await openWith({ payNote: 'Yape 987 654 321', payQr: 'data:image/jpeg;base64,QR' });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await eventually(() => expect($('payBox').hidden).toBe(false));
    expect(text('payNoteOut')).toBe('Yape 987 654 321');
    expect($('payQrBox').hidden).toBe(false);
    expect($<HTMLAnchorElement>('payQrSave').href).toMatch(/^data:image\/jpeg/);

    click($('copyPayNote'));
    await eventually(() => expect(text('copyPayNote')).toBe('Copiado ✓'));
    const select = vi.spyOn(window.getSelection()!, 'selectAllChildren');
    click($('copyPayNote'));
    await eventually(() => expect(select).toHaveBeenCalled());

    click($('download'));
    await eventually(() => expect(mocks.renderCard).toHaveBeenCalledWith(expect.objectContaining({ payNote: 'Yape 987 654 321' })));
  });

  it('solo nota, sin QR; y se actualiza si cambian', async () => {
    const link = await openWith({ payNote: 'Plin 123' });
    await eventually(() => expect(text('payNoteOut')).toBe('Plin 123'));
    expect($('payQrBox').hidden).toBe(true);
    await pushShare(link, { ...game, payNote: 'Plin 456', payQr: null }, true);
    document.dispatchEvent(new Event('visibilitychange'));
    await eventually(() => expect(text('payNoteOut')).toBe('Plin 456'));
  });

  it('sin datos para pagar no muestra la sección', async () => {
    await open();
    await eventually(() => expect($('panel').hidden).toBe(false));
    expect($('payBox').hidden).toBe(true);
  });
});

describe('errorView', () => {
  it('distingue errores definitivos de fallos pasajeros', async () => {
    await open(() => '');
    const { errorView } = await import('../src/scripts/viewer');
    const { ShareError } = await import('../src/scripts/share');
    expect(errorView(new ShareError('x', 404), true)).toMatchObject({ stop: true, title: 'Este link ya no existe' });
    expect(errorView(new ShareError('x', 400), false)).toMatchObject({ stop: true, title: 'Link incompleto' });
    expect(errorView(new Error('red'), true)).toBeNull();
    expect(errorView(new Error('red'), false)).toMatchObject({ stop: false, title: 'Sin conexión' });
  });
});
