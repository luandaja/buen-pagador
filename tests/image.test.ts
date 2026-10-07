import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesToDataUrl, canvasToBlob, fileToDataUrl, loadImage, resizeToCanvas, qrFromFile, shareImageBytes, thumbFrom } from '../src/scripts/image';
import { FakeImage, installFakeCanvas } from './helpers/canvas';

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
});

describe('loadImage', () => {
  it('resolves on load and rejects on error', async () => {
    await expect(loadImage('data:ok')).resolves.toBeInstanceOf(FakeImage);
    await expect(loadImage('broken')).rejects.toThrow(/Could not load/);
  });
});

describe('resizeToCanvas', () => {
  it('caps the longest side without upscaling small photos', () => {
    installFakeCanvas();
    const image = Object.assign(new FakeImage(), { naturalWidth: 3200, naturalHeight: 1600 });
    const big = resizeToCanvas(image as unknown as HTMLImageElement, 1600);
    expect([big.width, big.height]).toEqual([1600, 800]);
    const small = resizeToCanvas(Object.assign(new FakeImage(), { naturalWidth: 300, naturalHeight: 200 }) as never, 1600);
    expect([small.width, small.height]).toEqual([300, 200]);
  });
});

describe('encoding', () => {
  it('canvasToBlob rejects when the browser cannot encode', async () => {
    installFakeCanvas({ failBlob: true });
    await expect(canvasToBlob(document.createElement('canvas'))).rejects.toThrow(/Could not encode/);
  });

  it('fileToDataUrl returns a JPEG and revokes the temporary URL', async () => {
    installFakeCanvas();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const url = await fileToDataUrl(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }));
    expect(url).toMatch(/^data:image\/jpeg/);
    expect(revoke).toHaveBeenCalled();
  });

  it('shareImageBytes returns the JPEG bytes', async () => {
    installFakeCanvas();
    const bytes = await shareImageBytes('data:ok');
    expect(new TextDecoder().decode(bytes)).toBe('fake-image');
  });

  it('qrFromFile shrinks the QR and revokes the temporary URL', async () => {
    installFakeCanvas();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    expect(await qrFromFile(new File(['x'], 'qr.png', { type: 'image/png' }))).toMatch(/^data:image\/jpeg/);
    expect(revoke).toHaveBeenCalled();
  });

  it('thumbFrom makes a JPEG thumbnail', async () => {
    installFakeCanvas();
    expect(await thumbFrom('data:ok')).toMatch(/^data:image\/jpeg/);
  });

  it('bytesToDataUrl encodes as base64', async () => {
    expect(await bytesToDataUrl(new Uint8Array([104, 101, 121, 33]))).toBe('data:image/jpeg;base64,aGV5IQ==');
  });
});
