import * as faceapi from '@vladmandic/face-api';
import { runDetection, type Region } from './detect-core';

const unsupported = () => {
  throw new Error('No disponible en el worker');
};
class NoImage {}
class NoVideo {}
faceapi.env.setEnv({
  Canvas: OffscreenCanvas,
  CanvasRenderingContext2D: OffscreenCanvasRenderingContext2D,
  Image: NoImage,
  ImageData,
  Video: NoVideo,
  createCanvasElement: () => new OffscreenCanvas(1, 1),
  createImageElement: unsupported,
  createVideoElement: unsupported,
  fetch: (url: string, init?: RequestInit) => fetch(url, init),
  readFile: unsupported,
} as unknown as Parameters<typeof faceapi.env.setEnv>[0]);

let ready: Promise<void> | null = null;

function load() {
  ready ??= (async () => {
    await (faceapi.tf as unknown as { ready(): Promise<void> }).ready();
    await faceapi.nets.ssdMobilenetv1.loadFromUri(new URL('/models', self.location.origin).href);
  })();
  return ready;
}

function detectorFor(bitmap: ImageBitmap) {
  return async (r: Region, scale: number) => {
    const canvas = new OffscreenCanvas(Math.round(r.sw * scale), Math.round(r.sh * scale));
    canvas.getContext('2d')!.drawImage(bitmap, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
    const options = new faceapi.SsdMobilenetv1Options({ minConfidence: r.minConfidence, maxResults: 80 });
    return faceapi.detectAllFaces(canvas as unknown as HTMLCanvasElement, options);
  };
}

type Request = { id: number; bitmap?: ImageBitmap };

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  const { id, bitmap } = data;
  try {
    await load();
    if (!bitmap) return;
    const boxes = await runDetection(bitmap.width, bitmap.height, detectorFor(bitmap));
    self.postMessage({ id, boxes });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  } finally {
    bitmap?.close();
  }
};
