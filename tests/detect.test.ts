import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeCanvas } from './helpers/canvas';

type Detection = { box: { x: number; y: number; width: number; height: number }; score: number };

// Doble de face-api: cada pasada (foto completa y luego cada cuadrante) toma la siguiente respuesta.
const detections = vi.hoisted(() => ({ queue: [] as Detection[][] }));

vi.mock('@vladmandic/face-api', () => ({
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
    // Foto 2000×1000: la pasada completa va a 1024 px (escala 0.512) y cada
    // cuadrante de 1200×600 también a 1024 px.
    const full = 1024 / 2000;
    const q = 1024 / 1200;
    detections.queue = [
      [{ box: { x: 1000 * full, y: 100 * full, width: 100 * full, height: 100 * full }, score: 0.95 }],
      [
        // La misma cara vista en el primer cuadrante: es un duplicado.
        { box: { x: 1000 * q, y: 100 * q, width: 100 * q, height: 100 * q }, score: 0.8 },
        // Una cara chica que solo aparece en el cuadrante.
        { box: { x: 100 * q, y: 100 * q, width: 40 * q, height: 40 * q }, score: 0.7 },
        // Ruido de 5 px.
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
