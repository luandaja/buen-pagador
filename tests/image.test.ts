import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bytesToDataUrl, canvasToBlob, fileToDataUrl, loadImage, resizeToCanvas, shareImageBytes, thumbFrom } from '../src/scripts/image';
import { FakeImage, installFakeCanvas } from './helpers/canvas';

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
});

describe('loadImage', () => {
  it('resuelve cuando carga y rechaza si falla', async () => {
    await expect(loadImage('data:ok')).resolves.toBeInstanceOf(FakeImage);
    await expect(loadImage('broken')).rejects.toThrow(/No pudimos abrir/);
  });
});

describe('resizeToCanvas', () => {
  it('limita el lado mayor sin agrandar fotos chicas', () => {
    installFakeCanvas();
    const img = Object.assign(new FakeImage(), { naturalWidth: 3200, naturalHeight: 1600 });
    const big = resizeToCanvas(img as unknown as HTMLImageElement, 1600);
    expect([big.width, big.height]).toEqual([1600, 800]);
    const small = resizeToCanvas(Object.assign(new FakeImage(), { naturalWidth: 300, naturalHeight: 200 }) as never, 1600);
    expect([small.width, small.height]).toEqual([300, 200]);
  });
});

describe('codificación', () => {
  it('canvasToBlob rechaza si el navegador no genera la imagen', async () => {
    installFakeCanvas({ failBlob: true });
    await expect(canvasToBlob(document.createElement('canvas'))).rejects.toThrow(/No se pudo/);
  });

  it('fileToDataUrl devuelve un JPEG y libera la URL temporal', async () => {
    installFakeCanvas();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const url = await fileToDataUrl(new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
    expect(url).toMatch(/^data:image\/jpeg/);
    expect(revoke).toHaveBeenCalled();
  });

  it('shareImageBytes devuelve los bytes del JPEG', async () => {
    installFakeCanvas();
    const bytes = await shareImageBytes('data:ok');
    expect(new TextDecoder().decode(bytes)).toBe('fake-image');
  });

  it('thumbFrom genera una miniatura JPEG', async () => {
    installFakeCanvas();
    expect(await thumbFrom('data:ok')).toMatch(/^data:image\/jpeg/);
  });

  it('bytesToDataUrl codifica en base64', async () => {
    expect(await bytesToDataUrl(new Uint8Array([104, 111, 108, 97]))).toBe('data:image/jpeg;base64,aG9sYQ==');
  });
});
