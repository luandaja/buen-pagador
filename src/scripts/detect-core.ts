export interface DetectedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
  minConfidence: number;
}

export interface RawDetection {
  box: { x: number; y: number; width: number; height: number };
  score: number;
}

export type RegionDetector = (region: Region, scale: number) => Promise<RawDetection[]>;

export const MAX_SIDE = 1024;
const MIN_SIDE_FOR_QUADRANTS = 700;
const QUADRANT_OVERLAP = 0.2;
const FULL_IMAGE_CONFIDENCE = 0.4;
const QUADRANT_CONFIDENCE = 0.55;
const DUPLICATE_IOU = 0.3;
const DUPLICATE_CONTAINMENT = 0.6;
const MIN_FACE_PIXELS = 14;

export function planRegions(imageWidth: number, imageHeight: number): Region[] {
  const regions: Region[] = [{ x: 0, y: 0, width: imageWidth, height: imageHeight, minConfidence: FULL_IMAGE_CONFIDENCE }];
  if (Math.max(imageWidth, imageHeight) < MIN_SIDE_FOR_QUADRANTS) return regions;
  const quadrantWidth = Math.round((imageWidth * (1 + QUADRANT_OVERLAP)) / 2);
  const quadrantHeight = Math.round((imageHeight * (1 + QUADRANT_OVERLAP)) / 2);
  for (const x of [0, imageWidth - quadrantWidth]) {
    for (const y of [0, imageHeight - quadrantHeight]) {
      regions.push({ x, y, width: quadrantWidth, height: quadrantHeight, minConfidence: QUADRANT_CONFIDENCE });
    }
  }
  return regions;
}

export const regionScale = (region: Region) => Math.min(1, MAX_SIDE / Math.max(region.width, region.height));

export function toBoxes(found: RawDetection[], region: Region, scale: number, imageWidth: number, imageHeight: number): DetectedBox[] {
  return found.map(({ box, score }) => ({
    x: (region.x + box.x / scale) / imageWidth,
    y: (region.y + box.y / scale) / imageHeight,
    w: box.width / scale / imageWidth,
    h: box.height / scale / imageHeight,
    score,
  }));
}

function overlap(first: DetectedBox, second: DetectedBox, aspectRatio: number) {
  const overlapWidth = Math.max(0, Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x));
  const overlapHeight = Math.max(0, Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y));
  const intersection = overlapWidth * overlapHeight * aspectRatio;
  const firstArea = first.w * first.h * aspectRatio;
  const secondArea = second.w * second.h * aspectRatio;
  return {
    iou: intersection / (firstArea + secondArea - intersection),
    containment: intersection / Math.min(firstArea, secondArea),
  };
}

export function merge(boxes: DetectedBox[], aspectRatio: number): DetectedBox[] {
  const kept: DetectedBox[] = [];
  for (const box of [...boxes].sort((first, second) => second.score - first.score)) {
    const isDuplicate = kept.some((keptBox) => {
      const { iou, containment } = overlap(keptBox, box, aspectRatio);
      return iou > DUPLICATE_IOU || containment > DUPLICATE_CONTAINMENT;
    });
    if (!isDuplicate) kept.push(box);
  }
  return kept;
}

type Pause = () => Promise<void>;
const noPause: Pause = async () => {};

export async function runDetection(imageWidth: number, imageHeight: number, detect: RegionDetector, pause = noPause): Promise<DetectedBox[]> {
  const allBoxes: DetectedBox[] = [];
  for (const region of planRegions(imageWidth, imageHeight)) {
    const scale = regionScale(region);
    allBoxes.push(...toBoxes(await detect(region, scale), region, scale, imageWidth, imageHeight));
    await pause();
  }
  return merge(allBoxes, imageWidth / imageHeight)
    .filter((box) => box.w * imageWidth >= MIN_FACE_PIXELS)
    .sort((first, second) => first.x - second.x);
}
