export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No pudimos abrir esa imagen. Prueba con un JPG o PNG.'));
    img.src = src;
  });
}

export function resizeToCanvas(img: HTMLImageElement, max: number): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), type, quality),
  );
}

export async function fileToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    return resizeToCanvas(await loadImage(url), 1600).toDataURL('image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function shareImageBytes(dataUrl: string): Promise<Uint8Array<ArrayBuffer>> {
  const blob = await canvasToBlob(resizeToCanvas(await loadImage(dataUrl), 1280), 'image/jpeg', 0.8);
  return new Uint8Array(await blob.arrayBuffer());
}

export function bytesToDataUrl(bytes: Uint8Array, type = 'image/jpeg'): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  });
}

export async function thumbFrom(dataUrl: string): Promise<string> {
  return resizeToCanvas(await loadImage(dataUrl), 160).toDataURL('image/jpeg', 0.7);
}

export async function qrFromFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    return resizeToCanvas(await loadImage(url), 480).toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}
