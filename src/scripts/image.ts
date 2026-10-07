export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load image'));
    image.src = src;
  });
}

export function resizeToCanvas(image: HTMLImageElement, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))), type, quality),
  );
}

export async function fileToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return resizeToCanvas(await loadImage(objectUrl), 1600).toDataURL('image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(objectUrl);
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
  const objectUrl = URL.createObjectURL(file);
  try {
    return resizeToCanvas(await loadImage(objectUrl), 480).toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
