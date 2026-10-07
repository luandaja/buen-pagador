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

const photo = (width: number, height: number) => ({ naturalWidth: width, naturalHeight: height }) as HTMLImageElement;

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.stubGlobal('createImageBitmap', undefined);
  installFakeCanvas();
  detections.queue = [];
});

describe('detectFaces', () => {
  it('small photos take a single pass with normalized boxes', async () => {
    const { detectFaces } = await import('../src/scripts/detect');
    detections.queue = [[{ box: { x: 60, y: 40, width: 30, height: 30 }, score: 0.9 }]];
    const faces = await detectFaces(photo(600, 400));
    expect(faces).toEqual([{ x: 0.1, y: 0.1, w: 0.05, h: 0.075, score: 0.9 }]);
  });

  it('large photos add quadrants and drop duplicates and noise', async () => {
    const { detectFaces } = await import('../src/scripts/detect');
    const full = 1024 / 2000;
    const quadrantScale = 1024 / 1200;
    detections.queue = [
      [{ box: { x: 1000 * full, y: 100 * full, width: 100 * full, height: 100 * full }, score: 0.95 }],
      [
        { box: { x: 1000 * quadrantScale, y: 100 * quadrantScale, width: 100 * quadrantScale, height: 100 * quadrantScale }, score: 0.8 },
        { box: { x: 100 * quadrantScale, y: 100 * quadrantScale, width: 40 * quadrantScale, height: 40 * quadrantScale }, score: 0.7 },
        { box: { x: 300 * quadrantScale, y: 300 * quadrantScale, width: 5 * quadrantScale, height: 5 * quadrantScale }, score: 0.9 },
      ],
    ];
    const faces = await detectFaces(photo(2000, 1000));
    expect(faces).toHaveLength(2);
    expect(faces[0].x).toBeCloseTo(0.05);
    expect(faces[1]).toMatchObject({ score: 0.95 });
  });

  it('warmUp loads the model once and recovers from errors', async () => {
    const api = await import('@vladmandic/face-api');
    const { warmUp, detectFaces } = await import('../src/scripts/detect');
    vi.mocked(api.nets.ssdMobilenetv1.loadFromUri).mockRejectedValueOnce(new Error('offline'));
    warmUp();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(detectFaces(photo(100, 100))).resolves.toEqual([]);
  });
});

function fakeWorker(reply: (msg: { id: number }) => object | null) {
  const posted: unknown[] = [];
  class FakeWorker {
    listeners: Record<string, ((event: { data: unknown }) => void)[]> = {};
    addEventListener(type: string, listener: (event: { data: unknown }) => void) {
      (this.listeners[type] ??= []).push(listener);
    }
    removeEventListener(type: string, listener: (event: { data: unknown }) => void) {
      this.listeners[type] = (this.listeners[type] ?? []).filter((registered) => registered !== listener);
    }
    postMessage(msg: { id: number }) {
      posted.push(msg);
      const data = reply(msg);
      if (data) setTimeout(() => this.listeners.message?.forEach((listener) => listener({ data: { id: 999 } })));
      if (data) setTimeout(() => this.listeners.message?.forEach((listener) => listener({ data: { id: msg.id, ...data } })));
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
  return posted;
}

describe('detectFaces in the background', () => {
  const box = { x: 0.1, y: 0.2, w: 0.05, h: 0.05, score: 0.9 };

  it('uses the worker and returns its boxes', async () => {
    fakeWorker(() => ({ boxes: [box] }));
    const { detectFaces } = await import('../src/scripts/detect');
    expect(await detectFaces(photo(800, 600))).toEqual([box]);
  });

  it('falls back to the page when the worker fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fakeWorker(() => ({ error: 'no WebGL' }));
    const { detectFaces } = await import('../src/scripts/detect');
    detections.queue = [[{ box: { x: 60, y: 40, width: 30, height: 30 }, score: 0.9 }]];
    expect(await detectFaces(photo(600, 400))).toHaveLength(1);
  });

  it('uses the page when the worker cannot be created', async () => {
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

  it('warmUp asks the worker to load the model once', async () => {
    const posted = fakeWorker(() => null);
    const { warmUp, resetDetector } = await import('../src/scripts/detect');
    warmUp();
    expect(posted).toEqual([{ id: 0 }]);
    resetDetector();
  });
});
