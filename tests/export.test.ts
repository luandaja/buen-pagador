import { beforeEach, describe, expect, it, vi } from 'vitest';
import { containBox, fitText, renderCard, SIZE, statCells, statusLine } from '../src/scripts/export';
import { computeTotals, defaultState, type Face, type State } from '../src/scripts/state';
import { fakeContext, FakeImage, installFakeCanvas } from './helpers/canvas';

const face = (id: string, paid: boolean): Face => ({ id, x: 0.1, y: 0.1, w: 0.1, h: 0.1, emoji: '🐸', paid });

const state: State = {
  ...defaultState(),
  image: 'data:image/jpeg;base64,AAAA',
  title: 'Jueves 9 pm',
  cost: 100,
  faces: [face('a', true), face('b', false)],
};

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
  // happy-dom no implementa la carga de fuentes.
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve(), load: vi.fn(async () => []) },
  });
});

const texts = (calls: unknown[][]) => calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);

describe('renderCard', () => {
  it('dibuja una tarjeta cuadrada con foto, emojis y marcas de pagado', async () => {
    const contexts = installFakeCanvas();
    const canvas = await renderCard(state);
    expect([canvas.width, canvas.height]).toEqual([SIZE, SIZE]);
    const calls = contexts.at(-1)!.calls;
    expect(calls.some((c) => c[0] === 'drawImage')).toBe(true);
    expect(texts(calls)).toEqual(expect.arrayContaining(['JUEVES 9 PM', '🐸', 'CUOTA', 'S/ 50']));
  });

  it('sin foto muestra el porcentaje enorme', async () => {
    const contexts = installFakeCanvas();
    await renderCard({ ...state, includePhoto: false, faces: [face('a', true)] });
    const calls = contexts.at(-1)!.calls;
    expect(calls.some((c) => c[0] === 'drawImage')).toBe(false);
    expect(texts(calls)).toEqual(expect.arrayContaining(['100%', 'S/ 100 de S/ 100', 'LA CANCHA'.replace('LA CANCHA', 'JUEVES 9 PM')]));
  });

  it('sin título usa "La cancha"', async () => {
    const contexts = installFakeCanvas();
    await renderCard({ ...state, title: '  ', image: null });
    expect(texts(contexts.at(-1)!.calls)).toContain('LA CANCHA');
  });
});

describe('piezas de la tarjeta', () => {
  it('fitText achica la fuente hasta que entra, con un mínimo', () => {
    const ctx = fakeContext();
    expect(fitText(ctx, 'corto', 1000, 96, 900, 'X')).toBe(96);
    expect(fitText(ctx, 'un texto bastante largo', 200, 96, 900, 'X')).toBeLessThan(96);
    expect(fitText(ctx, 'x'.repeat(500), 10, 96, 900, 'X')).toBe(24);
  });

  it('containBox centra la foto dentro de la caja', () => {
    expect(containBox(2, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(containBox(0.5, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 25, y: 0, w: 50, h: 100 });
  });

  it('statusLine resume el avance', () => {
    const t = (faces: Face[]) => computeTotals({ faces, cost: 10, rounding: 0 });
    expect(statusLine(t([]))).toEqual({ text: 'SIN JUGADORES TODAVÍA', done: false });
    expect(statusLine(t([face('a', true)])).done).toBe(true);
    expect(statusLine(t([face('a', true), face('b', false)])).text).toBe('50% PAGADO · FALTA 1 PERSONA');
    expect(statusLine(t([face('a', false), face('b', false)])).text).toBe('0% PAGADO · FALTAN 2 PERSONAS');
  });

  it('statCells arma el marcador', () => {
    const t = computeTotals(state);
    expect(statCells(state, t)).toEqual([
      ['CANCHA', 'S/ 100'],
      ['CUOTA', 'S/ 50'],
      ['PAGARON', '1/2'],
      ['FALTA', 'S/ 50'],
    ]);
  });
});
