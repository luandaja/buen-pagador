// Lógica de detección que no depende de dónde corre (página o Web Worker).
// Para fotos grupales se hace una pasada a la foto completa y otra en
// cuadrantes solapados, así las caras pequeñas del fondo también aparecen.

export interface DetectedBox {
  /** Coordenadas normalizadas 0–1 respecto a la imagen. */
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

/** Recorte de la foto a analizar, en píxeles. */
export interface Region {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  minConfidence: number;
}

/** Lo que devuelve face-api para cada cara (en píxeles del recorte escalado). */
export interface RawDetection {
  box: { x: number; y: number; width: number; height: number };
  score: number;
}

/** Analiza un recorte ya escalado por `scale` y devuelve sus detecciones. */
export type RegionDetector = (region: Region, scale: number) => Promise<RawDetection[]>;

export const MAX_SIDE = 1024;

export function planRegions(W: number, H: number): Region[] {
  const regions: Region[] = [{ sx: 0, sy: 0, sw: W, sh: H, minConfidence: 0.4 }];
  if (Math.max(W, H) < 700) return regions;
  const overlap = 0.2;
  const tw = Math.round((W * (1 + overlap)) / 2);
  const th = Math.round((H * (1 + overlap)) / 2);
  for (const sx of [0, W - tw]) {
    for (const sy of [0, H - th]) regions.push({ sx, sy, sw: tw, sh: th, minConfidence: 0.55 });
  }
  return regions;
}

export const regionScale = (r: Region) => Math.min(1, MAX_SIDE / Math.max(r.sw, r.sh));

export function toBoxes(found: RawDetection[], r: Region, scale: number, W: number, H: number): DetectedBox[] {
  return found.map(({ box: b, score }) => ({
    x: (r.sx + b.x / scale) / W,
    y: (r.sy + b.y / scale) / H,
    w: b.width / scale / W,
    h: b.height / scale / H,
    score,
  }));
}

function overlap(a: DetectedBox, b: DetectedBox, aspect: number) {
  // Trabajamos en píxeles relativos para que el aspecto no distorsione el área.
  const iw = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const ih = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = iw * ih * aspect;
  const areaA = a.w * a.h * aspect;
  const areaB = b.w * b.h * aspect;
  return { iou: inter / (areaA + areaB - inter), containment: inter / Math.min(areaA, areaB) };
}

/** Quita duplicados (la misma cara vista en dos pasadas), quedándose con la más segura. */
export function merge(boxes: DetectedBox[], aspect: number): DetectedBox[] {
  const kept: DetectedBox[] = [];
  for (const box of [...boxes].sort((a, b) => b.score - a.score)) {
    const dup = kept.some((k) => {
      const o = overlap(k, box, aspect);
      return o.iou > 0.3 || o.containment > 0.6;
    });
    if (!dup) kept.push(box);
  }
  return kept;
}

type Pause = () => Promise<void>;
const noPause: Pause = async () => {};

/**
 * Corre todas las pasadas con `detect` y une los resultados.
 * `pause` se llama entre pasadas (en la página, para no congelar la interfaz).
 */
export async function runDetection(W: number, H: number, detect: RegionDetector, pause = noPause): Promise<DetectedBox[]> {
  const all: DetectedBox[] = [];
  for (const region of planRegions(W, H)) {
    const scale = regionScale(region);
    all.push(...toBoxes(await detect(region, scale), region, scale, W, H));
    await pause();
  }
  // Sin cuadrados minúsculos (ruido) y ordenadas de izquierda a derecha.
  return merge(all, W / H)
    .filter((b) => b.w * W >= 14)
    .sort((a, b) => a.x - b.x);
}
