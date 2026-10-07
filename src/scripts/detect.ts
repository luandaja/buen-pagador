// Detección de rostros en el navegador con SSD MobileNet (face-api).
// Corre en un Web Worker para no congelar la página; si el navegador no
// puede, corre aquí mismo con pausas entre pasadas.
import { runDetection, type DetectedBox, type Region } from './detect-core';

export type { DetectedBox } from './detect-core';

type FaceApi = typeof import('@vladmandic/face-api');
type Reply = { id: number; boxes?: DetectedBox[]; error?: string };

// ——— Web Worker ———
let worker: Worker | null | undefined;
let lastId = 0;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./detect.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  return worker;
}

/** Manda la foto al worker y espera las cajas. */
function askWorker(w: Worker, bitmap: ImageBitmap): Promise<DetectedBox[]> {
  const id = ++lastId;
  return new Promise((resolve, reject) => {
    const onMessage = ({ data }: MessageEvent<Reply>) => {
      if (data.id !== id) return;
      w.removeEventListener('message', onMessage);
      if (data.error) reject(new Error(data.error));
      else resolve(data.boxes ?? []);
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', reject, { once: true });
    w.postMessage({ id, bitmap }, [bitmap]);
  });
}

// ——— En la página (respaldo) ———
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

function cropCanvas(img: HTMLImageElement, r: Region, scale: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(r.sw * scale);
  canvas.height = Math.round(r.sh * scale);
  canvas.getContext('2d')!.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Deja respirar a la interfaz entre pasadas. */
const yieldToPage = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function detectInPage(img: HTMLImageElement): Promise<DetectedBox[]> {
  const faceapi = await loadApi();
  const detect = async (r: Region, scale: number) =>
    faceapi.detectAllFaces(cropCanvas(img, r, scale), new faceapi.SsdMobilenetv1Options({ minConfidence: r.minConfidence, maxResults: 80 }));
  return runDetection(img.naturalWidth, img.naturalHeight, detect, yieldToPage);
}

// ——— API ———
export async function detectFaces(img: HTMLImageElement): Promise<DetectedBox[]> {
  const w = typeof createImageBitmap === 'function' ? getWorker() : null;
  if (w) {
    try {
      return await askWorker(w, await createImageBitmap(img));
    } catch (err) {
      console.warn('[buen-pagador] La detección en segundo plano falló; sigo en la página.', err);
      worker = null;
    }
  }
  return detectInPage(img);
}

/** Empieza a descargar el modelo sin bloquear (útil al cargar la página). */
export function warmUp(): void {
  const w = getWorker();
  if (w) return w.postMessage({ id: 0 });
  loadApi().catch(() => {
    apiPromise = null;
  });
}

/** Solo para tests: olvida el worker y el modelo. */
export function resetDetector() {
  worker = undefined;
  apiPromise = null;
}
