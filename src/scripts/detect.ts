// Detección de rostros 100% en el navegador con SSD MobileNet (face-api).
// Para fotos grupales hacemos una pasada a la imagen completa y otra en
// cuadrantes solapados, así las caras pequeñas del fondo también aparecen.

type FaceApi = typeof import('@vladmandic/face-api');

export interface DetectedBox {
  /** Coordenadas normalizadas 0–1 respecto a la imagen. */
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

const MAX_SIDE = 1024;

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

/** Empieza a descargar el modelo sin bloquear (útil al cargar la página). */
export function warmUp(): void {
  loadApi().catch(() => {
    apiPromise = null;
  });
}

function crop(img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number) {
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return { canvas, scale };
}

async function detectRegion(
  faceapi: FaceApi,
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  minConfidence: number,
): Promise<DetectedBox[]> {
  const { canvas, scale } = crop(img, sx, sy, sw, sh);
  const options = new faceapi.SsdMobilenetv1Options({ minConfidence, maxResults: 80 });
  const results = await faceapi.detectAllFaces(canvas, options);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  return results.map((d) => {
    const b = d.box;
    return {
      x: (sx + b.x / scale) / W,
      y: (sy + b.y / scale) / H,
      w: b.width / scale / W,
      h: b.height / scale / H,
      score: d.score,
    };
  });
}

function overlap(a: DetectedBox, b: DetectedBox, aspect: number) {
  // Trabajamos en píxeles relativos para que el aspecto no distorsione el área.
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const iw = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const ih = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = iw * ih * aspect;
  const areaA = a.w * a.h * aspect;
  const areaB = b.w * b.h * aspect;
  return {
    iou: inter / (areaA + areaB - inter),
    containment: inter / Math.min(areaA, areaB),
  };
}

function merge(boxes: DetectedBox[], aspect: number): DetectedBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept: DetectedBox[] = [];
  for (const box of sorted) {
    const dup = kept.some((k) => {
      const o = overlap(k, box, aspect);
      return o.iou > 0.3 || o.containment > 0.6;
    });
    if (!dup) kept.push(box);
  }
  return kept;
}

export async function detectFaces(img: HTMLImageElement): Promise<DetectedBox[]> {
  const faceapi = await loadApi();
  const W = img.naturalWidth;
  const H = img.naturalHeight;

  const all = await detectRegion(faceapi, img, 0, 0, W, H, 0.4);

  // Cuadrantes solapados para caras pequeñas.
  if (Math.max(W, H) >= 700) {
    const overlapRatio = 0.2;
    const tw = Math.round((W * (1 + overlapRatio)) / 2);
    const th = Math.round((H * (1 + overlapRatio)) / 2);
    for (const sx of [0, W - tw]) {
      for (const sy of [0, H - th]) {
        all.push(...(await detectRegion(faceapi, img, sx, sy, tw, th, 0.55)));
      }
    }
  }

  // Sin cuadrados minúsculos (ruido) y ordenadas de izquierda a derecha.
  return merge(all, W / H)
    .filter((b) => b.w * W >= 14)
    .sort((a, b) => a.x - b.x);
}
