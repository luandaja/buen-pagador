import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { linesOf, loadTesseract, ocrOnDevice, prefersLocalOcr, readReceipt, setPrefersLocalOcr, TESSERACT_URL } from '../../src/scripts/group/read-receipt';

vi.mock('../../src/scripts/image', () => ({
  receiptFromFile: vi.fn(async () => 'data:image/jpeg;base64,FOTO'),
  receiptForAi: vi.fn(async () => 'data:image/jpeg;base64,GRANDE'),
  loadImage: vi.fn(async () => ({ naturalHeight: 200, naturalWidth: 100 })),
}));

const tesseractLine = (text: string, y0: number, y1: number, x0?: number, x1?: number) => ({ text, bbox: { y0, y1, x0, x1 } });
const recognize = vi.fn(async () => ({
  data: { text: 'Pan con pollo 2 5.50\n', blocks: [{ paragraphs: [{ lines: [tesseractLine('Pan con pollo 2 5.50\n', 40, 60, 10, 90)] }] }] },
}));
const terminate = vi.fn(async () => {});
const createWorker = vi.fn(async () => ({ recognize, terminate }));
const load = async () => ({ createWorker });

const aiReply = JSON.parse(readFileSync(resolve('tests/fixtures/receipt-ai.json'), 'utf8'));
const file = new File(['x'], 'boleta.jpg', { type: 'image/jpeg' });

afterEach(() => vi.unstubAllGlobals());

describe('readReceipt', () => {
  it('uses the AI when it answers', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(aiReply)));
    vi.stubGlobal('fetch', fetcher);
    const ocr = vi.fn();
    const read = await readReceipt(file, false, ocr);
    expect(read).toMatchObject({ source: 'ai', photo: 'data:image/jpeg;base64,FOTO', parsed: { total: 497.09 } });
    expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ image: 'GRANDE' });
    expect(ocr).not.toHaveBeenCalled();
  });

  it('falls back to the device when the AI fails, is offline or reads nothing', async () => {
    const ocr = vi.fn(async () => [{ text: 'Pan con pollo 2 5.50' }]);
    for (const fetcher of [
      async () => new Response('{"error":"quota"}', { status: 503 }),
      async () => {
        throw new TypeError('offline');
      },
      async () => new Response('{"items":[]}'),
    ]) {
      vi.stubGlobal('fetch', vi.fn(fetcher));
      expect(await readReceipt(file, false, ocr)).toMatchObject({ source: 'device', parsed: { items: [{ what: 'Pan con pollo', amount: 11 }] } });
    }
  });

  it('never calls the AI when the person prefers reading on the device', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const read = await readReceipt(file, true, async () => [{ text: 'Pan con pollo 2 5.50', band: { top: 0.2, bottom: 0.3 } }]);
    expect(read.parsed.items[0].band).toEqual({ top: 0.2, bottom: 0.3 });
    expect(read.source).toBe('device');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('remembers the preference and survives blocked storage', () => {
    expect(prefersLocalOcr()).toBe(false);
    setPrefersLocalOcr(true);
    expect(prefersLocalOcr()).toBe(true);
    setPrefersLocalOcr(false);
    expect(prefersLocalOcr()).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(prefersLocalOcr()).toBe(false);
    expect(() => setPrefersLocalOcr(true)).not.toThrow();
    vi.restoreAllMocks();
  });

  it('falls back to plain text lines when Tesseract gives no layout', () => {
    expect(linesOf({ text: 'a\nb', blocks: null }, 100)).toEqual([{ text: 'a' }, { text: 'b' }]);
    expect(linesOf({ text: '', blocks: [{ paragraphs: [{ lines: [tesseractLine(' x ', 10, 5)] }] }] }, 100)).toEqual([{ text: 'x', band: undefined }]);
  });

  it('loads a pinned Tesseract build from the CDN only when needed', () => {
    expect(TESSERACT_URL).toMatch(/tesseract\.js@\d+\.\d+\.\d+\/dist\/tesseract\.esm\.min\.js$/);
    expect(typeof loadTesseract).toBe('function');
  });

  it('runs Tesseract in Spanish and always frees the worker', async () => {
    expect(await ocrOnDevice('data:x', load)).toEqual([{ text: 'Pan con pollo 2 5.50', band: { top: 0.2, bottom: 0.3, left: 0.1, right: 0.9 } }]);
    expect(recognize).toHaveBeenCalledWith('data:x', {}, { text: true, blocks: true });
    expect(createWorker).toHaveBeenCalledWith('spa');
    recognize.mockRejectedValueOnce(new Error('bad image'));
    await expect(ocrOnDevice('data:x', load)).rejects.toThrow('bad image');
    expect(terminate).toHaveBeenCalledTimes(2);
  });
});
