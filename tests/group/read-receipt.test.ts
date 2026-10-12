import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ocrOnDevice, prefersLocalOcr, readReceipt, setPrefersLocalOcr } from '../../src/scripts/group/read-receipt';

vi.mock('../../src/scripts/image', () => ({
  receiptFromFile: vi.fn(async () => 'data:image/jpeg;base64,FOTO'),
  receiptForAi: vi.fn(async () => 'data:image/jpeg;base64,GRANDE'),
}));

const recognize = vi.fn(async () => ({ data: { text: 'Pan con pollo 2 5.50\n' } }));
const terminate = vi.fn(async () => {});
vi.mock('tesseract.js', () => ({ createWorker: vi.fn(async () => ({ recognize, terminate })) }));

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
    const ocr = vi.fn(async () => 'Pan con pollo 2 5.50\n');
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
    const read = await readReceipt(file, true, async () => 'Pan con pollo 2 5.50\n');
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

  it('runs Tesseract in Spanish and always frees the worker', async () => {
    expect(await ocrOnDevice('data:x')).toBe('Pan con pollo 2 5.50\n');
    const { createWorker } = await import('tesseract.js');
    expect(createWorker).toHaveBeenCalledWith('spa');
    recognize.mockRejectedValueOnce(new Error('bad image'));
    await expect(ocrOnDevice('data:x')).rejects.toThrow('bad image');
    expect(terminate).toHaveBeenCalledTimes(2);
  });
});
