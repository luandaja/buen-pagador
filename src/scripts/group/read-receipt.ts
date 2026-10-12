import { loadImage, receiptForAi, receiptFromFile } from '../image';
import { normalizeParsed, parseReceiptLines, toBand, type OcrLine, type ParsedReceipt } from './receipt';

export type ReceiptSource = 'ai' | 'device';

export interface ReadReceipt {
  parsed: ParsedReceipt;
  source: ReceiptSource;
  photo: string;
}

export const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';

type Box = { x0?: number; x1?: number; y0: number; y1: number };
type TesseractLine = { text: string; bbox: Box };
type TesseractData = { text: string; blocks?: { paragraphs: { lines: TesseractLine[] }[] }[] | null };
type Worker = { recognize: (image: string, options?: object, output?: object) => Promise<{ data: TesseractData }>; terminate: () => Promise<unknown> };
type Tesseract = { createWorker: (lang: string) => Promise<Worker> };

export async function loadTesseract(): Promise<Tesseract> {
  const module = await import(/* @vite-ignore */ TESSERACT_URL);
  return module.default ?? module;
}

export function linesOf(data: TesseractData, height: number, width = 0): OcrLine[] {
  const lines = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines));
  if (!lines.length) return data.text.split('\n').map((text) => ({ text }));
  const across = (x: number | undefined) => (width && x != null ? x / width : undefined);
  return lines.map(({ text, bbox }) => ({ text: text.trim(), band: toBand(bbox.y0 / height, bbox.y1 / height, across(bbox.x0), across(bbox.x1)) }));
}

export async function ocrOnDevice(image: string, load: () => Promise<Tesseract> = loadTesseract): Promise<OcrLine[]> {
  const [{ createWorker }, picture] = await Promise.all([load(), loadImage(image)]);
  const worker = await createWorker('spa');
  try {
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
    return linesOf(data, picture.naturalHeight || 1, picture.naturalWidth);
  } finally {
    await worker.terminate();
  }
}

async function readWithAi(image: string): Promise<ParsedReceipt | null> {
  try {
    const response = await fetch('/api/receipt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: image.slice(image.indexOf(',') + 1) }),
    });
    if (!response.ok) return null;
    const parsed = normalizeParsed(await response.json());
    return parsed.items.length ? parsed : null;
  } catch {
    return null;
  }
}

const LOCAL_ONLY_KEY = 'buen-pagador:receipt-local-only';

export function prefersLocalOcr(): boolean {
  try {
    return localStorage.getItem(LOCAL_ONLY_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPrefersLocalOcr(localOnly: boolean) {
  try {
    if (localOnly) localStorage.setItem(LOCAL_ONLY_KEY, '1');
    else localStorage.removeItem(LOCAL_ONLY_KEY);
  } catch {
    return;
  }
}

export async function readReceipt(file: File, localOnly = false, ocr: (image: string) => Promise<OcrLine[]> = ocrOnDevice): Promise<ReadReceipt> {
  const [photo, image] = await Promise.all([receiptFromFile(file), receiptForAi(file)]);
  const fromAi = localOnly ? null : await readWithAi(image);
  if (fromAi) return { parsed: fromAi, source: 'ai', photo };
  return { parsed: parseReceiptLines(await ocr(image)), source: 'device', photo };
}
