// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { es } from '../src/i18n/es';
import { resetStore } from '../src/lib/store';
import PublicPage from '../src/pages/view.astro';
import { createShare, deleteShare, pushShare, type ShareLink } from '../src/scripts/share';
import { defaultState, money, type State } from '../src/scripts/state';
import { useApiFetch } from './helpers/api';
import { byId, click, eventually, mount, renderPage, unmount } from './helpers/dom';

const mocks = vi.hoisted(() => ({ renderCard: vi.fn() }));

vi.mock('../src/scripts/export', () => ({ renderCard: mocks.renderCard }));
vi.mock('../src/scripts/image', () => ({
  canvasToBlob: vi.fn(async () => new Blob(['png'])),
  shareImageBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  bytesToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
}));

const ORIGIN = 'http://localhost:4321';
let pageHtml = '';

const sharedGame: State = {
  ...defaultState(),
  image: 'data:image/jpeg;base64,AAAA',
  title: 'Thursday',
  cost: 60,
  faces: [
    { id: 'a', x: 0.1, y: 0.1, w: 0.1, h: 0.1, emoji: '🐸', paid: true },
    { id: 'b', x: 0.4, y: 0.1, w: 0.1, h: 0.1, emoji: '🦊', paid: false },
  ],
};

beforeAll(async () => {
  pageHtml = await renderPage(PublicPage);
});

beforeEach(() => {
  resetStore();
  mocks.renderCard.mockReset().mockImplementation(async () => ({}));
});

afterEach(async () => {
  await unmount();
});

async function openPublicView(hashFor?: (link: ShareLink) => string, overrides: Partial<State> = {}) {
  mount(pageHtml, `${ORIGIN}/view`);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useApiFetch();
  HTMLAnchorElement.prototype.click = vi.fn();
  const link = await createShare({ ...sharedGame, ...overrides });
  location.hash = hashFor ? hashFor(link) : `#${link.id}.${link.key}`;
  vi.resetModules();
  await import('../src/scripts/viewer');
  return link;
}

const openWithPayment = (overrides: Partial<State>) => openPublicView(undefined, overrides);
const textOf = (id: string) => byId(id).textContent;
const faceMarkers = () => [...document.querySelectorAll<HTMLElement>('.face')];
const panelVisible = () => eventually(() => expect(byId('panel').hidden).toBe(false));

describe('public view', () => {
  it('shows the photo, who paid and the progress without editing', async () => {
    await openPublicView();
    await panelVisible();
    expect(textOf('viewTitle')).toBe('Thursday');
    expect(document.title).toBe(es.meta.pageTitle('Thursday'));
    expect(textOf('paidOut')).toBe('1/2');
    expect(textOf('shareOut')).toBe(money(30, 'S/'));
    expect(faceMarkers().map((marker) => marker.tagName)).toEqual(['SPAN', 'SPAN']);
    expect(textOf('updated')).toMatch(/\d/);

    click(faceMarkers()[1]);
    expect(textOf('paidOut')).toBe('1/2');
  });

  it('refreshes when the tab becomes visible again', async () => {
    const link = await openPublicView();
    await eventually(() => expect(textOf('paidOut')).toBe('1/2'));
    const everyonePaid = sharedGame.faces.map((face) => ({ ...face, paid: true }));
    await pushShare(link, { ...sharedGame, title: '', faces: everyonePaid });
    document.dispatchEvent(new Event('visibilitychange'));
    await eventually(() => expect(textOf('paidOut')).toBe('2/2'));
    expect(textOf('viewTitle')).toBe(es.viewer.defaultTitle);
  });

  it('reports a deleted link', async () => {
    const link = await openPublicView();
    await panelVisible();
    await deleteShare(link);
    document.dispatchEvent(new Event('visibilitychange'));
    await eventually(() => expect(textOf('viewerStateTitle')).toBe(es.viewer.goneTitle));
    expect(byId('panel').hidden).toBe(true);
  });

  it('keeps the last data when offline', async () => {
    await openPublicView();
    await panelVisible();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(byId('panel').hidden).toBe(false);
  });

  it('reports an incomplete link or a wrong key', async () => {
    await openPublicView(() => '');
    expect(textOf('viewerStateTitle')).toBe(es.viewer.brokenTitle);

    await unmount();
    await openPublicView((link) => `#${link.id}.${'A'.repeat(43)}`);
    await eventually(() => expect(textOf('viewerStateTitle')).toBe(es.viewer.brokenTitle));
  });

  it('opens another link when the hash changes', async () => {
    const firstLink = await openPublicView();
    await eventually(() => expect(textOf('viewTitle')).toBe('Thursday'));
    const secondLink = await createShare({ ...sharedGame, title: 'Friday' });
    expect(secondLink.id).not.toBe(firstLink.id);
    location.hash = `#${secondLink.id}.${secondLink.key}`;
    window.dispatchEvent(new Event('hashchange'));
    await eventually(() => expect(textOf('viewTitle')).toBe('Friday'));
  });

  it('downloads the image and reports failures', async () => {
    await openPublicView();
    await panelVisible();
    click(byId('download'));
    await eventually(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
    expect(mocks.renderCard).toHaveBeenCalledWith(expect.objectContaining({ title: 'Thursday', includePhoto: true }));

    mocks.renderCard.mockRejectedValueOnce(new Error('canvas'));
    click(byId('download'));
    await eventually(() => expect(textOf('exportMsg')).toBe(es.image.failed));
  });
});

describe('how to pay', () => {
  it('shows the note and QR, and copies or saves them', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    await openWithPayment({ payNote: 'Wallet 987 654 321', payQr: 'data:image/jpeg;base64,QR' });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await eventually(() => expect(byId('payBox').hidden).toBe(false));
    expect(textOf('payNoteOut')).toBe('Wallet 987 654 321');
    expect(byId('payQrBox').hidden).toBe(false);
    expect(byId<HTMLAnchorElement>('payQrSave').href).toMatch(/^data:image\/jpeg/);

    click(byId('copyPayNote'));
    await eventually(() => expect(textOf('copyPayNote')).toBe(es.share.copied));
    const selectText = vi.spyOn(window.getSelection()!, 'selectAllChildren');
    click(byId('copyPayNote'));
    await eventually(() => expect(selectText).toHaveBeenCalled());

    click(byId('download'));
    await eventually(() => expect(mocks.renderCard).toHaveBeenCalledWith(expect.objectContaining({ payNote: 'Wallet 987 654 321' })));
  });

  it('shows only the note without a QR and updates when it changes', async () => {
    const link = await openWithPayment({ payNote: 'Wallet 123' });
    await eventually(() => expect(textOf('payNoteOut')).toBe('Wallet 123'));
    expect(byId('payQrBox').hidden).toBe(true);
    await pushShare(link, { ...sharedGame, payNote: 'Wallet 456', payQr: null }, true);
    document.dispatchEvent(new Event('visibilitychange'));
    await eventually(() => expect(textOf('payNoteOut')).toBe('Wallet 456'));
  });

  it('hides the section without payment details', async () => {
    await openPublicView();
    await panelVisible();
    expect(byId('payBox').hidden).toBe(true);
  });
});

describe('errorView', () => {
  it('tells permanent errors from transient failures', async () => {
    await openPublicView(() => '');
    const { errorView } = await import('../src/scripts/viewer');
    const { ShareError } = await import('../src/scripts/share');
    expect(errorView(new ShareError('x', 404), true)).toMatchObject({ stop: true, title: es.viewer.goneTitle });
    expect(errorView(new ShareError('x', 400), false)).toMatchObject({ stop: true, title: es.viewer.brokenTitle });
    expect(errorView(new Error('network'), true)).toBeNull();
    expect(errorView(new Error('network'), false)).toMatchObject({ stop: false, title: es.viewer.offlineTitle });
  });
});
