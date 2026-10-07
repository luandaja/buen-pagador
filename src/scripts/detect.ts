import { runDetection, type DetectedBox, type Region } from './detect-core';

export type { DetectedBox } from './detect-core';

const MAX_RESULTS = 80;

type FaceApi = typeof import('@vladmandic/face-api');
type WorkerReply = { id: number; boxes?: DetectedBox[]; error?: string };

let worker: Worker | null | undefined;
let lastRequestId = 0;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./detect.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  return worker;
}

function askWorker(detectionWorker: Worker, bitmap: ImageBitmap): Promise<DetectedBox[]> {
  const requestId = ++lastRequestId;
  return new Promise((resolve, reject) => {
    const onMessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (data.id !== requestId) return;
      detectionWorker.removeEventListener('message', onMessage);
      if (data.error) reject(new Error(data.error));
      else resolve(data.boxes ?? []);
    };
    detectionWorker.addEventListener('message', onMessage);
    detectionWorker.addEventListener('error', reject, { once: true });
    detectionWorker.postMessage({ id: requestId, bitmap }, [bitmap]);
  });
}

let apiPromise: Promise<FaceApi> | null = null;

function loadApi(): Promise<FaceApi> {
  apiPromise ??= (async () => {
    const faceapi = await import('@vladmandic/face-api');
    await (faceapi.tf as unknown as { ready(): Promise<void> }).ready();
    await faceapi.nets.ssdMobilenetv1.loadFromUri('/models');
    return faceapi;
  })();
  return apiPromise;
}

function cropCanvas(image: HTMLImageElement, region: Region, scale: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(region.width * scale);
  canvas.height = Math.round(region.height * scale);
  canvas.getContext('2d')!.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const yieldToPage = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function detectInPage(image: HTMLImageElement): Promise<DetectedBox[]> {
  const faceapi = await loadApi();
  const detect = async (region: Region, scale: number) =>
    faceapi.detectAllFaces(cropCanvas(image, region, scale), new faceapi.SsdMobilenetv1Options({ minConfidence: region.minConfidence, maxResults: MAX_RESULTS }));
  return runDetection(image.naturalWidth, image.naturalHeight, detect, yieldToPage);
}

export async function detectFaces(image: HTMLImageElement): Promise<DetectedBox[]> {
  const detectionWorker = typeof createImageBitmap === 'function' ? getWorker() : null;
  if (detectionWorker) {
    try {
      return await askWorker(detectionWorker, await createImageBitmap(image));
    } catch (error) {
      console.warn('[buen-pagador] Background detection failed; falling back to the page.', error);
      worker = null;
    }
  }
  return detectInPage(image);
}

export function warmUp(): void {
  const detectionWorker = getWorker();
  if (detectionWorker) return detectionWorker.postMessage({ id: 0 });
  loadApi().catch(() => {
    apiPromise = null;
  });
}

export function resetDetector() {
  worker = undefined;
  apiPromise = null;
}
