import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyBoxes, containBox, fitText, renderCard, SIZE, statCells, statusLine } from '../src/scripts/export';
import { es } from '../src/i18n/es';
import { computeTotals, defaultState, money, type Face, type State } from '../src/scripts/state';
import { fakeContext, FakeImage, installFakeCanvas } from './helpers/canvas';

const face = (id: string, paid: boolean): Face => ({ id, x: 0.1, y: 0.1, w: 0.1, h: 0.1, emoji: '🐸', paid });

const state: State = {
  ...defaultState(),
  image: 'data:image/jpeg;base64,AAAA',
  title: 'Thursday 9 pm',
  cost: 100,
  faces: [face('a', true), face('b', false)],
};

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve(), load: vi.fn(async () => []) },
  });
});

const texts = (calls: unknown[][]) => calls.filter((call) => call[0] === 'fillText').map((call) => call[1]);

describe('renderCard', () => {
  it('draws a square card with photo, emojis and paid marks', async () => {
    const contexts = installFakeCanvas();
    const canvas = await renderCard(state);
    expect([canvas.width, canvas.height]).toEqual([SIZE, SIZE]);
    const calls = contexts.at(-1)!.calls;
    expect(calls.some((call) => call[0] === 'drawImage')).toBe(true);
    expect(texts(calls)).toEqual(expect.arrayContaining(['THURSDAY 9 PM', '🐸', es.card.stats.share, money(50, 'S/')]));
  });

  it('without a photo it shows a large percentage', async () => {
    const contexts = installFakeCanvas();
    await renderCard({ ...state, includePhoto: false, faces: [face('a', true)] });
    const calls = contexts.at(-1)!.calls;
    expect(calls.some((call) => call[0] === 'drawImage')).toBe(false);
    expect(texts(calls)).toEqual(expect.arrayContaining(['100%', es.card.collectedOf(money(100, 'S/'), money(100, 'S/')), 'THURSDAY 9 PM']));
  });

  it('uses the default title when empty', async () => {
    const contexts = installFakeCanvas();
    await renderCard({ ...state, title: '  ', image: null });
    expect(texts(contexts.at(-1)!.calls)).toContain(es.card.defaultTitle.toUpperCase());
  });
});

describe('payment details on the card', () => {
  it('draws the note and the QR', async () => {
    const contexts = installFakeCanvas();
    await renderCard({ ...state, payNote: 'Wallet 987 654 321', payQr: 'data:qr' });
    const calls = contexts.at(-1)!.calls;
    expect(texts(calls)).toEqual(expect.arrayContaining([es.card.payNote('Wallet 987 654 321'), es.card.scanToPay]));
    expect(calls.filter((call) => call[0] === 'drawImage')).toHaveLength(2);
  });

  it('the note pushes the body down and the QR shrinks the thermometer', () => {
    const plain = bodyBoxes(false, false);
    const full = bodyBoxes(true, true);
    expect(plain.qr).toBeNull();
    expect(full.left.y).toBeGreaterThan(plain.left.y);
    expect(full.qr).toMatchObject({ x: full.thermo.x, y: full.left.y });
    expect(full.thermo.y).toBeGreaterThan(full.qr!.y + full.qr!.h);
    expect(full.thermo.h).toBeGreaterThan(250);
  });
});

describe('card pieces', () => {
  it('fitText shrinks the font until it fits, down to a minimum', () => {
    const ctx = fakeContext();
    expect(fitText(ctx, 'short', 1000, 96, 900, 'X')).toBe(96);
    expect(fitText(ctx, 'a fairly long piece of text', 200, 96, 900, 'X')).toBeLessThan(96);
    expect(fitText(ctx, 'x'.repeat(500), 10, 96, 900, 'X')).toBe(24);
  });

  it('containBox centers the photo inside the box', () => {
    expect(containBox(2, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(containBox(0.5, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 25, y: 0, w: 50, h: 100 });
  });

  it('statusLine summarizes progress', () => {
    const totalsFor = (faces: Face[]) => computeTotals({ faces, cost: 10, rounding: 0 });
    expect(statusLine(totalsFor([]))).toEqual({ text: es.card.noPlayers, done: false });
    expect(statusLine(totalsFor([face('a', true)])).done).toBe(true);
    expect(statusLine(totalsFor([face('a', true), face('b', false)])).text).toBe(es.card.pending(50, 1));
    expect(statusLine(totalsFor([face('a', false), face('b', false)])).text).toBe(es.card.pending(0, 2));
  });

  it('statCells builds the scoreboard', () => {
    const totals = computeTotals(state);
    expect(statCells(state, totals)).toEqual([
      [es.card.stats.cost, money(100, 'S/')],
      [es.card.stats.share, money(50, 'S/')],
      [es.card.stats.paid, '1/2'],
      [es.card.stats.missing, money(50, 'S/')],
    ]);
  });
});
