import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  setEnv: vi.fn(),
  detectAllFaces: vi.fn(),
  loadFromUri: vi.fn(async () => {}),
}));

vi.mock('@vladmandic/face-api', () => ({
  env: { setEnv: api.setEnv },
  tf: { ready: vi.fn(async () => {}) },
  nets: { ssdMobilenetv1: { loadFromUri: api.loadFromUri } },
  SsdMobilenetv1Options: class {
    constructor(public opts: unknown) {}
  },
  detectAllFaces: api.detectAllFaces,
}));

class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return { drawImage: vi.fn() };
  }
}

type Handler = (e: { data: { id: number; bitmap?: { width: number; height: number; close: () => void } } }) => Promise<void>;

async function loadWorker() {
  vi.resetModules();
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  vi.stubGlobal('OffscreenCanvasRenderingContext2D', class {});
  const post = vi.fn();
  vi.stubGlobal('postMessage', post);
  self.postMessage = post;
  await import('../src/scripts/detect.worker');
  return { post, handler: self.onmessage as unknown as Handler };
}

const bitmap = () => ({ width: 600, height: 400, close: vi.fn() });

beforeEach(() => {
  api.detectAllFaces.mockReset();
  api.setEnv.mockClear();
  api.loadFromUri.mockClear();
});

describe('worker de detección', () => {
  it('prepara un entorno sin DOM y carga el modelo con URL absoluta', async () => {
    const { handler, post } = await loadWorker();
    expect(api.setEnv).toHaveBeenCalledWith(expect.objectContaining({ Canvas: FakeOffscreenCanvas }));
    const env = api.setEnv.mock.calls[0][0];
    expect(env.createCanvasElement()).toBeInstanceOf(FakeOffscreenCanvas);
    expect(() => env.createImageElement()).toThrow();

    await handler({ data: { id: 0 } });
    expect(api.loadFromUri).toHaveBeenCalledWith(`${location.origin}/models`);
    expect(post).not.toHaveBeenCalled();
  });

  it('detecta en la foto y devuelve cajas normalizadas', async () => {
    api.detectAllFaces.mockResolvedValue([{ box: { x: 60, y: 40, width: 30, height: 30 }, score: 0.9 }]);
    const { handler, post } = await loadWorker();
    const bmp = bitmap();
    await handler({ data: { id: 7, bitmap: bmp } });
    expect(post).toHaveBeenCalledWith({ id: 7, boxes: [{ x: 0.1, y: 0.1, w: 0.05, h: 0.075, score: 0.9 }] });
    expect(bmp.close).toHaveBeenCalled();
  });

  it('avisa si falla', async () => {
    api.detectAllFaces.mockRejectedValue(new Error('sin WebGL'));
    const { handler, post } = await loadWorker();
    await handler({ data: { id: 3, bitmap: bitmap() } });
    expect(post).toHaveBeenCalledWith({ id: 3, error: 'Error: sin WebGL' });
  });
});
