// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { es } from '../src/i18n/es';
import { resetStore } from '../src/lib/store';
import EditorPage from '../src/pages/index.astro';
import { createShare, loadShare, pushShare, type ShareLink } from '../src/scripts/share';
import { DEBTOR_EMOJIS, defaultPrefs, defaultState, money, newGame, type Game, type State } from '../src/scripts/state';
import { useApiFetch } from './helpers/api';
import { byId, click, eventually, input, mount, renderPage, unmount } from './helpers/dom';

const mocks = vi.hoisted(() => ({
  detectedBoxes: [] as { x: number; y: number; w: number; h: number; score: number }[],
  detectFaces: vi.fn(),
  renderCard: vi.fn(),
  fileToDataUrl: vi.fn(),
  qrFromFile: vi.fn(),
}));

vi.mock('../src/scripts/detect', () => ({ detectFaces: mocks.detectFaces, warmUp: vi.fn() }));
vi.mock('../src/scripts/export', () => ({ renderCard: mocks.renderCard }));
vi.mock('../src/scripts/image', () => ({
  fileToDataUrl: mocks.fileToDataUrl,
  canvasToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  shareImageBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  bytesToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,BBBB'),
  thumbFrom: vi.fn(async () => 'data:image/jpeg;base64,THUMB'),
  qrFromFile: mocks.qrFromFile,
}));

const ORIGIN = 'http://localhost:4321';
const PHOTO = 'data:image/jpeg;base64,AAAA';
const THUMB = 'data:image/jpeg;base64,THUMB';
const QR = 'data:image/jpeg;base64,QR';

let pageHtml = '';
let gameStore: typeof import('../src/scripts/games');

beforeAll(async () => {
  pageHtml = await renderPage(EditorPage);
});

beforeEach(() => {
  resetStore();
  mocks.detectedBoxes = [
    { x: 0.1, y: 0.1, w: 0.1, h: 0.1, score: 0.9 },
    { x: 0.4, y: 0.1, w: 0.1, h: 0.1, score: 0.9 },
    { x: 0.7, y: 0.1, w: 0.1, h: 0.1, score: 0.9 },
  ];
  mocks.detectFaces.mockReset().mockImplementation(async () => mocks.detectedBoxes);
  mocks.renderCard.mockReset().mockImplementation(async () => ({}));
  mocks.fileToDataUrl.mockReset().mockImplementation(async () => PHOTO);
  mocks.qrFromFile.mockReset().mockImplementation(async () => QR);
});

afterEach(async () => {
  await unmount();
});

interface EditorSetup {
  legacyState?: Partial<State>;
  savedGames?: Game[];
  openGameId?: string;
  hash?: string;
}

async function startEditor({ legacyState, savedGames = [], openGameId, hash = '' }: EditorSetup = {}) {
  mount(pageHtml, `${ORIGIN}/${hash}`);
  globalThis.indexedDB = new IDBFactory();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useApiFetch();
  Object.defineProperties(byId<HTMLImageElement>('photo'), {
    naturalWidth: { value: 800 },
    naturalHeight: { value: 600 },
    decode: { value: async () => {} },
  });
  vi.spyOn(byId('faces'), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600 } as DOMRect);
  HTMLAnchorElement.prototype.click = vi.fn();
  vi.resetModules();
  gameStore = await import('../src/scripts/games');
  for (const game of savedGames) await gameStore.saveGame(game);
  if (openGameId) localStorage.setItem('buen-pagador:prefs', JSON.stringify({ ...defaultPrefs(), currentGameId: openGameId }));
  if (legacyState) localStorage.setItem('buen-pagador:v1', JSON.stringify({ ...defaultState(), ...legacyState }));
  await import('../src/scripts/app');
}

function selectFile(inputId: string, type: string) {
  const fileInput = byId<HTMLInputElement>(inputId);
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [new File(['x'], 'upload', { type })] });
  fileInput.dispatchEvent(new Event('change'));
}

const uploadPhoto = (type = 'image/jpeg') => selectFile('file', type);
const uploadQr = (type = 'image/png') => selectFile('payQrFile', type);

function answerConfirm(answer: boolean) {
  const confirmDialog = vi.fn(() => answer);
  globalThis.confirm = confirmDialog;
  return confirmDialog;
}

function failNetwork() {
  globalThis.fetch = vi.fn(async () => {
    throw new TypeError('offline');
  }) as typeof fetch;
}

const masterHash = (link: ShareLink, prefix = 'edit') => `#${prefix}=${link.id}.${link.key}.${link.token}`;
const faceButtons = () => [...document.querySelectorAll<HTMLButtonElement>('.face')];
const textOf = (id: string) => byId(id).textContent;
const storedPrefs = () => JSON.parse(localStorage.getItem('buen-pagador:prefs') ?? '{}');
const openGameRecord = async () => gameStore.loadGame(storedPrefs().currentGameId);
const historyRows = () => [...document.querySelectorAll<HTMLElement>('.game-row')];
const historyRow = (title: string) => historyRows().find((row) => row.querySelector('strong')?.textContent === title)!;
const isDialogOpen = () => byId<HTMLDialogElement>('history').open;

function buildGame(overrides: Partial<Game> = {}): Game {
  return {
    ...newGame(),
    image: PHOTO,
    cost: 90,
    faces: ['a', 'b', 'c'].map((id, index) => ({ id, x: 0.1 * index, y: 0.1, w: 0.1, h: 0.1, emoji: DEBTOR_EMOJIS[index], paid: false })),
    ...overrides,
  };
}

const settledGame = (overrides: Partial<Game> = {}) =>
  buildGame({ faces: buildGame().faces.map((face) => ({ ...face, paid: true })), ...overrides });

async function startWithGame(overrides: Partial<Game> = {}) {
  const game = buildGame(overrides);
  await startEditor({ savedGames: [game], openGameId: game.id });
  return game;
}

async function openHistoryDrawer() {
  click(byId('openHistory'));
  await eventually(() => expect(historyRows().length).toBeGreaterThan(0));
}

async function createRemoteLink(overrides: Partial<Game> = {}) {
  mount(pageHtml, ORIGIN);
  useApiFetch();
  const link = await createShare({ ...defaultState(), ...buildGame(overrides) });
  await unmount();
  return link;
}

describe('photo and faces', () => {
  it('starts empty with steps, detects faces and computes the share', async () => {
    await startEditor();
    expect(byId('dropzone').hidden).toBe(false);
    expect(byId('steps').hidden).toBe(false);
    expect(byId('progressWrap').hidden).toBe(true);
    expect(byId('linkShare').hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.panel-actions')!.hidden).toBe(true);
    expect(byId('gameForm').hidden).toBe(false);

    input(byId<HTMLInputElement>('cost'), '120');
    expect(document.querySelectorAll('#steps li')[1].classList.contains('is-done')).toBe(true);

    uploadPhoto();
    await eventually(() => expect(faceButtons()).toHaveLength(3));
    expect(byId('stageWrap').hidden).toBe(false);
    expect(byId('steps').hidden).toBe(true);
    expect(textOf('shareOut')).toBe(money(40, 'S/'));
    expect(textOf('heroOut')).toBe(money(120, 'S/'));
    expect(textOf('gameMeta')).toBe([es.game.metaCost(money(120, 'S/')), es.game.metaPlayers(3)].join(' · '));
    expect(textOf('dockSum')).toBe(`${es.progress.ownerMissing} ${money(120, 'S/')} · 0/3`);

    input(byId<HTMLInputElement>('cost'), 'abc');
    expect(textOf('shareOut')).toBe('—');
    expect(textOf('missingOut')).toBe(es.status.setCost);
  });

  it('marks payments, announces progress, adds and removes faces', async () => {
    await startWithGame();
    click(faceButtons()[0]);
    expect(textOf('paidOut')).toBe('1/3');
    expect(textOf('announce')).toBe(es.faces.announce(1, true, 1, 3));
    click(faceButtons()[0]);
    expect(textOf('announce')).toBe(es.faces.announce(1, false, 0, 3));

    click(byId('faces'));
    expect(faceButtons()).toHaveLength(3);

    const editModeButton = document.querySelector('[data-mode="edit"]')!;
    click(editModeButton);
    expect(editModeButton.getAttribute('aria-pressed')).toBe('true');
    click(byId('faces'), { clientX: 400, clientY: 300 });
    expect(faceButtons()).toHaveLength(4);
    click(faceButtons()[3]);
    expect(faceButtons()).toHaveLength(3);
  });

  it('reports non-images, photos without faces and failed detection', async () => {
    await startEditor();
    uploadPhoto('text/plain');
    expect(textOf('exportMsg')).toBe(es.upload.notImage);

    mocks.detectedBoxes = [];
    uploadPhoto();
    await eventually(() => expect(textOf('hint')).toBe(es.upload.noFaces));
    expect(byId('stage').classList.contains('is-edit')).toBe(true);

    mocks.detectFaces.mockRejectedValueOnce(new Error('model unavailable'));
    uploadPhoto();
    await eventually(() => expect(textOf('hint')).toBe(es.upload.detectFailed));
  });

  it('accepts dropped photos', async () => {
    await startEditor();
    const dropzone = byId('dropzone');
    dropzone.dispatchEvent(new Event('dragover', { cancelable: true }));
    expect(dropzone.classList.contains('is-over')).toBe(true);
    dropzone.dispatchEvent(new Event('dragleave'));
    expect(dropzone.classList.contains('is-over')).toBe(false);
    const dropEvent = new Event('drop', { cancelable: true }) as Event & { dataTransfer: unknown };
    dropEvent.dataTransfer = { files: [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })] };
    dropzone.dispatchEvent(dropEvent);
    await eventually(() => expect(faceButtons()).toHaveLength(3));
  });

  it('asks before changing the photo when payments are marked', async () => {
    await startWithGame({ faces: buildGame().faces.map((face, index) => ({ ...face, paid: index === 0 })) });
    const openFilePicker = vi.spyOn(byId<HTMLInputElement>('file'), 'click');
    answerConfirm(false);
    click(byId('newPhoto'));
    expect(openFilePicker).not.toHaveBeenCalled();
    answerConfirm(true);
    click(byId('newPhoto'));
    expect(openFilePicker).toHaveBeenCalled();
  });
});

describe('emojis', () => {
  const rightClick = (target: Element) => target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

  it('right click blocks an emoji and it can be restored', async () => {
    await startWithGame();
    const blockedEmoji = faceButtons()[0].querySelector('.face-emoji')!.textContent!;
    rightClick(faceButtons()[0]);
    expect(textOf('hint')).toBe(es.hints.blockedEmoji(blockedEmoji));
    expect(textOf('blockedList')).toBe(blockedEmoji);
    rightClick(faceButtons()[0]);
    expect(textOf('blockedList')).toBe(blockedEmoji);
    click(byId('unblock'));
    expect(byId('blockedBar').hidden).toBe(true);
  });

  it('warns when too few emojis remain', async () => {
    await startEditor({ legacyState: { ...buildGame(), blocked: DEBTOR_EMOJIS.slice(3, 20) } });
    rightClick(faceButtons()[0]);
    expect(textOf('hint')).toBe(es.hints.tooFewEmojis);
  });

  it('long press blocks without marking the face as paid', async () => {
    await startWithGame();
    const target = faceButtons()[1];
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    await eventually(() => expect(textOf('blockedList')).not.toBe(''), 2000);
    click(target);
    expect(textOf('paidOut')).toBe('0/3');

    for (const [type, pointerType] of [
      ['pointerdown', 'touch'],
      ['pointermove', 'touch'],
      ['pointermove', 'mouse'],
      ['pointerup', 'touch'],
      ['pointerdown', 'mouse'],
    ]) {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType }));
    }
  });

  it('reveals faces and rerolls emojis', async () => {
    await startWithGame();
    click(byId('peek'));
    expect(byId('stage').classList.contains('is-peek')).toBe(true);
    expect(textOf('peek')).toContain(es.toolbar.unpeek);
    click(byId('peek'));
    expect(byId('stage').classList.contains('is-peek')).toBe(false);
    click(byId('reroll'));
    expect(faceButtons()).toHaveLength(3);
  });
});

describe('game card and persistence', () => {
  it('collapses, edits and saves everything to the history', async () => {
    await startWithGame({ title: 'Before' });
    expect(byId('gameForm').hidden).toBe(true);
    click(byId('editGame'));
    expect(byId('gameForm').hidden).toBe(false);
    expect(document.activeElement?.id).toBe('title');

    input(byId<HTMLInputElement>('title'), 'Thursday');
    input(byId<HTMLInputElement>('currency'), ' $ ');
    input(byId<HTMLSelectElement>('rounding'), '1', 'change');
    const includePhoto = byId<HTMLInputElement>('includePhoto');
    includePhoto.checked = false;
    includePhoto.dispatchEvent(new Event('change'));
    click(byId('doneGame'));
    expect(byId('gameForm').hidden).toBe(true);
    expect(textOf('gameTitle')).toBe('Thursday');

    window.dispatchEvent(new Event('pagehide'));
    await eventually(async () => expect(await openGameRecord()).toMatchObject({ title: 'Thursday', currency: '$', rounding: 1 }));
    expect(storedPrefs()).toMatchObject({ includePhoto: false });

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  it('migrates the previous version and creates a thumbnail', async () => {
    await startEditor({ legacyState: { ...buildGame({ title: 'Old' }), thumb: null } });
    expect(textOf('gameTitle')).toBe('Old');
    expect(localStorage.getItem('buen-pagador:v1')).toBeNull();
    await eventually(async () => expect((await openGameRecord())?.thumb).toBe(THUMB));
    expect(textOf('historyCount')).toBe('1');
  });
});

describe('payment details', () => {
  it('are edited on the card, summarized and shared with the link', async () => {
    await startWithGame();
    click(byId('editGame'));
    input(byId<HTMLTextAreaElement>('payNote') as unknown as HTMLInputElement, 'Wallet 987 654 321');
    uploadQr();
    await eventually(() => expect(byId('payQrPreview').hidden).toBe(false));
    expect(textOf('payQrLabel')).toBe(es.pay.changeQr);
    expect(byId('payChip').hidden).toBe(true);
    click(byId('doneGame'));
    expect(byId('payChip').hidden).toBe(false);
    expect(textOf('payChipNote')).toBe('Wallet 987 654 321');

    click(byId('linkAction'));
    await eventually(() => expect(textOf('syncStatus')).toBe(es.share.live));
    await eventually(async () => expect((await openGameRecord())?.share).toBeTruthy());
    const link = (await openGameRecord())!.share!;
    expect((await loadShare(link, false, true)).pay).toEqual({ note: 'Wallet 987 654 321', qr: QR });

    click(byId('editGame'));
    click(byId('payQrRemove'));
    expect(byId('payQrPreview').hidden).toBe(true);
    await eventually(async () => expect((await loadShare(link, false, true)).pay?.qr).toBeNull());
  });

  it('ignores non-image files and reports unreadable QR images', async () => {
    await startWithGame();
    uploadQr('text/plain');
    expect(mocks.qrFromFile).not.toHaveBeenCalled();
    mocks.qrFromFile.mockRejectedValueOnce(new Error('corrupt'));
    uploadQr();
    await eventually(() => expect(textOf('announce')).toBe(es.pay.qrError));
  });

  it('carry over to the next game', async () => {
    const game = settledGame({ title: 'Monday', payNote: 'Wallet 123' });
    await startEditor({ savedGames: [game], openGameId: game.id });
    click(byId('linkAction'));
    await eventually(() => expect(byId('stageWrap').hidden).toBe(true));
    expect(byId<HTMLTextAreaElement>('payNote').value).toBe('Wallet 123');
  });
});

describe('image export', () => {
  it('cannot save without a photo', async () => {
    await startEditor();
    expect(byId<HTMLButtonElement>('download').disabled).toBe(true);
  });

  it('saves the image named after the game', async () => {
    await startWithGame({ title: 'Thursday 9 pm' });
    click(byId('download'));
    await eventually(() => expect(textOf('exportMsg')).toBe(es.image.saved(es.image.fileName('thursday-9-pm'))));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it('reports rendering failures', async () => {
    await startWithGame();
    mocks.renderCard.mockRejectedValueOnce(new Error('canvas'));
    click(byId('download'));
    await eventually(() => expect(textOf('exportMsg')).toBe(es.image.failed));
  });

  it('shares the image', async () => {
    await startWithGame();
    const abortError = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const nativeShare = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(abortError).mockRejectedValueOnce(new Error('failed'));
    Object.assign(navigator, { share: nativeShare });
    click(byId('share'));
    await eventually(() => expect(nativeShare).toHaveBeenCalledTimes(1));
    click(byId('share'));
    await eventually(() => expect(nativeShare).toHaveBeenCalledTimes(2));
    expect(textOf('exportMsg')).toBe('');
    click(byId('share'));
    await eventually(() => expect(textOf('exportMsg')).toBe(es.image.shareFailed));
  });
});

describe('group link', () => {
  async function startWithLink() {
    await startWithGame();
    click(byId('linkAction'));
    await eventually(() => expect(textOf('syncStatus')).toBe(es.share.live));
  }

  it('creates the link, syncs payments and deactivates it', async () => {
    await startWithLink();
    const url = textOf('publicUrl')!;
    expect(url).toMatch(/\/view#[A-Za-z0-9]{10}\.[\w-]{43}$/);
    expect(textOf('linkAction')).toBe(es.share.copy);
    expect(byId('masterBox').hidden).toBe(false);

    click(faceButtons()[0]);
    expect(textOf('syncStatus')).toBe(es.share.saving);
    await eventually(() => expect(textOf('syncStatus')).toBe(es.share.live));
    const [id, key] = new URL(url).hash.slice(1).split('.');
    expect((await loadShare({ id, key }, false)).state.faces[0].paid).toBe(true);

    answerConfirm(false);
    click(byId('stopLink'));
    expect(byId('linkReady').hidden).toBe(false);
    answerConfirm(true);
    click(byId('stopLink'));
    await eventually(() => expect(textOf('syncStatus')).toBe(es.share.stopped));
    await expect(loadShare({ id, key }, false)).rejects.toMatchObject({ status: 404 });
  });

  it('copies the group link and the edit link', async () => {
    await startWithLink();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    click(byId('linkAction'));
    await eventually(() => expect(textOf('linkAction')).toBe(es.share.copied));
    expect(writeText).toHaveBeenLastCalledWith(textOf('publicUrl'));

    click(byId('copyMaster'));
    await eventually(() => expect(textOf('copyMaster')).toBe(es.share.copied));
    expect(writeText.mock.lastCall![0]).toMatch(/#edit=/);

    const selectText = vi.spyOn(window.getSelection()!, 'selectAllChildren');
    await new Promise((resolve) => setTimeout(resolve, 1600));
    click(byId('linkAction'));
    await eventually(() => expect(selectText).toHaveBeenCalled());
  });

  it('sends the link through the share sheet on phones', async () => {
    mount(pageHtml, ORIGIN);
    const originalMatchMedia = window.matchMedia.bind(window);
    await unmount();
    await startWithGame();
    window.matchMedia = ((query: string) => ({ ...originalMatchMedia(query), matches: query.includes('hover: none') })) as typeof window.matchMedia;
    const nativeShare = vi.fn(async () => {});
    Object.assign(navigator, { share: nativeShare });
    vi.resetModules();
    document.documentElement.innerHTML = pageHtml.replace(/^<!DOCTYPE html>/i, '');
    await import('../src/scripts/app');
    click(byId('linkAction'));
    await eventually(() => expect(textOf('linkAction')).toBe(es.share.send));
    click(byId('linkAction'));
    await eventually(() => expect(nativeShare).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(/\/view#/) })));
  });

  it('drops an expired link and retries when offline', async () => {
    await startWithLink();
    const realFetch = globalThis.fetch;
    failNetwork();
    click(faceButtons()[0]);
    await eventually(() => expect(textOf('syncStatus')).toBe(es.share.offlineRetry));
    expect(textOf('announce')).toBe(es.share.offlineRetry);

    globalThis.fetch = realFetch;
    const link = (await openGameRecord())!.share!;
    await realFetch(`/api/share/${link.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${link.token}` } });
    click(faceButtons()[1]);
    await eventually(() => expect(textOf('syncStatus')).toBe(es.share.expired));
    expect(byId('linkReady').hidden).toBe(true);
  });

  it('reports failures to create or deactivate', async () => {
    await startWithGame();
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('{"error":"invalid"}', { status: 400 })) as typeof fetch;
    click(byId('linkAction'));
    await eventually(() => expect(textOf('syncStatus')).toBe(es.errors.invalid));
    failNetwork();
    click(byId('linkAction'));
    await eventually(() => expect(textOf('syncStatus')).toBe(es.share.createFailed));

    globalThis.fetch = realFetch;
    click(byId('linkAction'));
    await eventually(() => expect(textOf('syncStatus')).toBe(es.share.live));
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 500 })) as typeof fetch;
    answerConfirm(true);
    click(byId('stopLink'));
    await eventually(() => expect(textOf('syncStatus')).toBe(es.share.stopFailed));
  });

  it('a new photo leaves the old link and asks for a new one', async () => {
    await startWithLink();
    uploadPhoto();
    await eventually(() => expect(textOf('syncStatus')).toBe(es.share.newPhotoNeedsLink));
    expect(byId('linkReady').hidden).toBe(true);
  });

  it('pulls payments from the server on open', async () => {
    const link = await createRemoteLink({ title: 'Remote' });
    mount(pageHtml, ORIGIN);
    useApiFetch();
    await pushShare(link, { ...defaultState(), ...buildGame({ title: 'Changed on another device' }) });
    await unmount();

    await startWithGame({ title: 'Local', share: link });
    await eventually(() => expect(textOf('gameTitle')).toBe('Changed on another device'));
  });
});

describe('my games', () => {
  it('lists grouped games and opens one', async () => {
    const owingGame = buildGame({ title: 'Thursday', updatedAt: 2 });
    const paidGame = settledGame({ title: 'Monday', updatedAt: 1 });
    await startEditor({ savedGames: [owingGame, paidGame], openGameId: owingGame.id });
    await eventually(() => expect(textOf('historyCount')).toBe('2'));
    expect(textOf('historyCountLabel')).toBe(es.history.countLabel(2));

    await openHistoryDrawer();
    expect(isDialogOpen()).toBe(true);
    const sectionTitles = [...document.querySelectorAll('.drawer-section')].map((heading) => heading.textContent);
    expect(sectionTitles).toEqual([es.history.debts, es.history.settled]);
    expect(historyRow('Thursday').classList.contains('is-current')).toBe(true);
    expect(textOf('historySummary')).toBe(es.history.owed(money(90, 'S/'), 1));

    click(historyRow('Monday').querySelector('[data-action=open]')!);
    await eventually(() => expect(textOf('gameTitle')).toBe('Monday'));
    expect(isDialogOpen()).toBe(false);
    expect(textOf('announce')).toBe(es.history.opened('Monday'));
    expect(textOf('linkAction')).toBe(es.share.next);
    expect(byId('progress').classList.contains('is-full')).toBe(true);

    await openHistoryDrawer();
    click(historyRow('Monday').querySelector('[data-action=open]')!);
    await eventually(() => expect(isDialogOpen()).toBe(false));
  });

  it('starts, repeats and continues to the next game', async () => {
    const paidGame = settledGame({ title: 'Monday', cost: 60, rounding: 1 });
    await startEditor({ savedGames: [paidGame], openGameId: paidGame.id });

    click(byId('linkAction'));
    await eventually(() => expect(byId('stageWrap').hidden).toBe(true));
    expect(textOf('gameTitle')).toBe('Monday');
    expect(byId<HTMLInputElement>('cost').value).toBe('60');
    expect(byId('gameForm').hidden).toBe(false);

    await openHistoryDrawer();
    click(byId('newGame'));
    await eventually(() => expect(textOf('gameTitle')).toBe(es.game.newGame));
    expect(byId<HTMLInputElement>('cost').value).toBe('');

    await openHistoryDrawer();
    const rowMenu = historyRow('Monday').querySelector('details')!;
    rowMenu.open = true;
    click(rowMenu.querySelector('[data-action=repeat]')!);
    await eventually(() => expect(textOf('gameTitle')).toBe('Monday'));
    expect(rowMenu.open).toBe(false);
  });

  it('deletes games, including the open one, and moves focus', async () => {
    const firstGame = buildGame({ title: 'A', updatedAt: 3 });
    const secondGame = buildGame({ title: 'B', updatedAt: 2 });
    await startEditor({ savedGames: [firstGame, secondGame], openGameId: firstGame.id });
    await openHistoryDrawer();

    answerConfirm(false);
    click(historyRow('B').querySelector('[data-action=delete]')!);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(historyRows()).toHaveLength(2);

    answerConfirm(true);
    click(historyRow('A').querySelector('[data-action=delete]')!);
    await eventually(() => expect(historyRows()).toHaveLength(1));
    expect(textOf('historyStatus')).toBe(es.history.removed('A'));
    expect(textOf('gameTitle')).toBe(es.game.newGame);
    expect(document.activeElement?.closest('[data-id]')?.getAttribute('data-id')).toBe(secondGame.id);
    expect(await gameStore.loadGame(firstGame.id)).toBeNull();

    click(historyRow('B').querySelector('[data-action=delete]')!);
    await eventually(() => expect(historyRows()).toHaveLength(0));
    expect(byId('historyEmpty').hidden).toBe(false);
    expect(document.activeElement?.id).toBe('newGame');
  });

  it('closes with the button or the backdrop and closes open menus', async () => {
    const game = buildGame({ title: 'A' });
    await startEditor({ savedGames: [game], openGameId: game.id });
    await openHistoryDrawer();
    click(byId('openHistory'));
    const rowMenu = historyRow('A').querySelector('details')!;
    rowMenu.open = true;
    click(byId('historySummary'));
    expect(rowMenu.open).toBe(false);
    click(byId('history'));
    expect(isDialogOpen()).toBe(false);
    await openHistoryDrawer();
    click(byId('closeHistory'));
    expect(isDialogOpen()).toBe(false);
  });

  it('cannot switch games while faces are being detected', async () => {
    let finishDetection: (boxes: typeof mocks.detectedBoxes) => void = () => {};
    mocks.detectFaces.mockImplementationOnce(() => new Promise((resolve) => (finishDetection = resolve)));
    await startEditor();
    uploadPhoto();
    await eventually(() => expect(byId<HTMLButtonElement>('openHistory').disabled).toBe(true));
    finishDetection(mocks.detectedBoxes);
    await eventually(() => expect(byId<HTMLButtonElement>('openHistory').disabled).toBe(false));
  });
});

describe('master link', () => {
  it('adds the game to the history on another device and cleans the URL', async () => {
    const link = await createRemoteLink({ title: 'Remote', cost: 60, payNote: 'Wallet 555' });
    await startEditor({ hash: masterHash(link) });
    await eventually(() => expect(textOf('syncStatus')).toBe(es.share.live));
    expect(byId<HTMLInputElement>('title').value).toBe('Remote');
    expect(faceButtons()).toHaveLength(3);
    expect(location.hash).toBe('');
    await eventually(async () => expect((await gameStore.findByShareId(link.id))?.title).toBe('Remote'));
    expect((await openGameRecord())?.thumb).toBe(THUMB);
    expect(byId<HTMLTextAreaElement>('payNote').value).toBe('Wallet 555');
  });

  it('still accepts links in the previous format', async () => {
    const link = await createRemoteLink({ title: 'Remote' });
    await startEditor({ hash: masterHash(link, 'editar') });
    await eventually(() => expect(textOf('gameTitle')).toBe('Remote'));
  });

  it('reuses the local game for that link and only refreshes it when already open', async () => {
    const link = await createRemoteLink({ title: 'Remote' });
    const localGame = buildGame({ title: 'Local', share: link, thumb: 'data:mine' });
    const otherGame = buildGame({ title: 'Other' });
    await startEditor({ savedGames: [localGame, otherGame], openGameId: otherGame.id, hash: masterHash(link) });
    await eventually(() => expect(textOf('gameTitle')).toBe('Remote'));
    expect(storedPrefs().currentGameId).toBe(localGame.id);
    expect(await gameStore.listGames()).toHaveLength(2);

    location.hash = masterHash(link);
    window.dispatchEvent(new Event('hashchange'));
    await eventually(() => expect(location.hash).toBe(''));
    expect(textOf('syncStatus')).toBe(es.share.live);
  });

  it('rejects invalid tokens and missing links, and reports network errors', async () => {
    const link = await createRemoteLink();
    await startEditor({ hash: masterHash({ ...link, token: 'x'.repeat(32) }) });
    await eventually(() => expect(textOf('syncStatus')).toBe(es.share.invalidMaster));

    await unmount();
    await startEditor({ hash: masterHash({ ...link, id: 'ZZZZZZZZZZ' }) });
    await eventually(() => expect(textOf('syncStatus')).toBe(es.errors.not_found));

    await unmount();
    await startEditor();
    failNetwork();
    location.hash = masterHash({ ...link, id: 'YYYYYYYYYY' });
    window.dispatchEvent(new Event('hashchange'));
    await eventually(() => expect(textOf('syncStatus')).toBe(es.share.openFailed));
  });
});
