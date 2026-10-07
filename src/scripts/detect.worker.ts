import * as faceapi from '@vladmandic/face-api';
import { runDetection, type Region } from './detect-core';

const unsupported = () => {
  throw new Error('Not available in a worker');
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

const MAX_RESULTS = 80;

let modelReady: Promise<void> | null = null;

function loadModel() {
  modelReady ??= (async () => {
    await (faceapi.tf as unknown as { ready(): Promise<void> }).ready();
    await faceapi.nets.ssdMobilenetv1.loadFromUri(new URL('/models', self.location.origin).href);
  })();
  return modelReady;
}

function detectorFor(bitmap: ImageBitmap) {
  return async (region: Region, scale: number) => {
    const canvas = new OffscreenCanvas(Math.round(region.width * scale), Math.round(region.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
    const options = new faceapi.SsdMobilenetv1Options({ minConfidence: region.minConfidence, maxResults: MAX_RESULTS });
    return faceapi.detectAllFaces(canvas as unknown as HTMLCanvasElement, options);
  };
}

type DetectionRequest = { id: number; bitmap?: ImageBitmap };

self.onmessage = async ({ data }: MessageEvent<DetectionRequest>) => {
  const { id, bitmap } = data;
  try {
    await loadModel();
    if (!bitmap) return;
    const boxes = await runDetection(bitmap.width, bitmap.height, detectorFor(bitmap));
    self.postMessage({ id, boxes });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  } finally {
    bitmap?.close();
  }
};
