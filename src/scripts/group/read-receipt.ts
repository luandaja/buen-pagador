import { receiptForAi, receiptFromFile } from '../image';
import { normalizeParsed, parseReceiptText, type ParsedReceipt } from './receipt';

export type ReceiptSource = 'ai' | 'device';

export interface ReadReceipt {
  parsed: ParsedReceipt;
  source: ReceiptSource;
  photo: string;
}

export async function ocrOnDevice(image: string): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('spa');
  try {
    return (await worker.recognize(image)).data.text;
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

export async function readReceipt(file: File, localOnly = false, ocr: (image: string) => Promise<string> = ocrOnDevice): Promise<ReadReceipt> {
  const [photo, image] = await Promise.all([receiptFromFile(file), receiptForAi(file)]);
  const fromAi = localOnly ? null : await readWithAi(image);
  if (fromAi) return { parsed: fromAi, source: 'ai', photo };
  return { parsed: parseReceiptText(await ocr(image)), source: 'device', photo };
}
