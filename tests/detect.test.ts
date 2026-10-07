import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeCanvas } from './helpers/canvas';

type Detection = { box: { x: number; y: number; width: number; height: number }; score: number };

const detections = vi.hoisted(() => ({ queue: [] as Detection[][] }));

vi.mock('@vladmandic/face-api', () => ({
  env: { setEnv: vi.fn() },
  tf: { ready: vi.fn(async () => {}) },
  nets: { ssdMobilenetv1: { loadFromUri: vi.fn(async () => {}) } },
  SsdMobilenetv1Options: class {
    constructor(public opts: unknown) {}
  },
  detectAllFaces: vi.fn(async () => detections.queue.shift() ?? []),
}));

const photo = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h }) as HTMLImageElement;

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.stubGlobal('createImageBitmap', undefined);
  installFakeCanvas();
  detections.queue = [];
});

describe('detectFaces', () => {
  it('en fotos chicas hace una sola pasada y normaliza las cajas', async () => {
    const { detectFaces } = await import('../src/scripts/detect');
    detections.queue = [[{ box: { x: 60, y: 40, width: 30, height: 30 }, score: 0.9 }]];
    const faces = await detectFaces(photo(600, 400));
    expect(faces).toEqual([{ x: 0.1, y: 0.1, w: 0.05, h: 0.075, score: 0.9 }]);
  });

  it('en fotos grandes suma los cuadrantes y descarta duplicados y ruido', async () => {
    const { detectFaces } = await import('../src/scripts/detect');
    const full = 1024 / 2000;
    const q = 1024 / 1200;
    detections.queue = [
      [{ box: { x: 1000 * full, y: 100 * full, width: 100 * full, height: 100 * full }, score: 0.95 }],
      [
        { box: { x: 1000 * q, y: 100 * q, width: 100 * q, height: 100 * q }, score: 0.8 },
        { box: { x: 100 * q, y: 100 * q, width: 40 * q, height: 40 * q }, score: 0.7 },
        { box: { x: 300 * q, y: 300 * q, width: 5 * q, height: 5 * q }, score: 0.9 },
      ],
    ];
    const faces = await detectFaces(photo(2000, 1000));
    expect(faces).toHaveLength(2);
    expect(faces[0].x).toBeCloseTo(0.05);
    expect(faces[1]).toMatchObject({ score: 0.95 });
  });

  it('warmUp carga el modelo una sola vez y se recupera de errores', async () => {
    const api = await import('@vladmandic/face-api');
    const { warmUp, detectFaces } = await import('../src/scripts/detect');
    vi.mocked(api.nets.ssdMobilenetv1.loadFromUri).mockRejectedValueOnce(new Error('sin red'));
    warmUp();
    await new Promise((r) => setTimeout(r, 0));
    await expect(detectFaces(photo(100, 100))).resolves.toEqual([]);
  });
});

function fakeWorker(reply: (msg: { id: number }) => object | null) {
  const posted: unknown[] = [];
  class FakeWorker {
    listeners: Record<string, ((e: { data: unknown }) => void)[]> = {};
    addEventListener(type: string, fn: (e: { data: unknown }) => void) {
      (this.listeners[type] ??= []).push(fn);
    }
    removeEventListener(type: string, fn: (e: { data: unknown }) => void) {
      this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
    }
    postMessage(msg: { id: number }) {
      posted.push(msg);
      const data = reply(msg);
      if (data) setTimeout(() => this.listeners.message?.forEach((fn) => fn({ data: { id: 999 } })));
      if (data) setTimeout(() => this.listeners.message?.forEach((fn) => fn({ data: { id: msg.id, ...data } })));
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
  return posted;
}

describe('detectFaces en segundo plano', () => {
  const box = { x: 0.1, y: 0.2, w: 0.05, h: 0.05, score: 0.9 };

  it('usa el worker y devuelve sus cajas', async () => {
    fakeWorker(() => ({ boxes: [box] }));
    const { detectFaces } = await import('../src/scripts/detect');
    expect(await detectFaces(photo(800, 600))).toEqual([box]);
  });

  it('si el worker falla, sigue en la página', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fakeWorker(() => ({ error: 'sin WebGL' }));
    const { detectFaces } = await import('../src/scripts/detect');
    detections.queue = [[{ box: { x: 60, y: 40, width: 30, height: 30 }, score: 0.9 }]];
    expect(await detectFaces(photo(600, 400))).toHaveLength(1);
  });

  it('si no se puede crear el worker, usa la página', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('no');
        }
      },
    );
    const { detectFaces, warmUp } = await import('../src/scripts/detect');
    warmUp();
    expect(await detectFaces(photo(100, 100))).toEqual([]);
  });

  it('warmUp le pide al worker que cargue el modelo, una vez', async () => {
    const posted = fakeWorker(() => null);
    const { warmUp, resetDetector } = await import('../src/scripts/detect');
    warmUp();
    expect(posted).toEqual([{ id: 0 }]);
    resetDetector();
  });
});
