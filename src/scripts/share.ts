// Cliente de links compartidos: arma los links, cifra y habla con /api/share.
import { decrypt, decryptJson, encrypt, encryptJson, importKey, newKey } from './crypto';
import type { Face, State } from './state';

export interface ShareLink {
  id: string;
  /** Clave AES en base64url (va solo en el # del link). */
  key: string;
  /** Token de edición (solo en el link maestro). */
  token: string;
}

/** Lo que ven los demás: sin foto, sin emojis bloqueados ni preferencias locales. */
export interface SharedState {
  title: string;
  cost: number | null;
  currency: string;
  rounding: number;
  faces: Face[];
}

export class ShareError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function publicUrl(link: Pick<ShareLink, 'id' | 'key'>): string {
  return `${location.origin}/ver#${link.id}.${link.key}`;
}

export function masterUrl(link: ShareLink): string {
  return `${location.origin}/#editar=${link.id}.${link.key}.${link.token}`;
}

export function parsePublicHash(hash: string): { id: string; key: string } | null {
  const m = hash.match(/^#([A-Za-z0-9]{10})\.([\w-]{43})$/);
  return m ? { id: m[1], key: m[2] } : null;
}

export function parseMasterHash(hash: string): ShareLink | null {
  const m = hash.match(/^#editar=([A-Za-z0-9]{10})\.([\w-]{43})\.([\w-]{32})$/);
  return m ? { id: m[1], key: m[2], token: m[3] } : null;
}

const round = (n: number) => Math.round(n * 10000) / 10000;

export function toShared(state: State): SharedState {
  return {
    title: state.title,
    cost: state.cost,
    currency: state.currency,
    rounding: state.rounding,
    faces: state.faces.map((f) => ({ ...f, x: round(f.x), y: round(f.y), w: round(f.w), h: round(f.h) })),
  };
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ShareError(data.error ?? 'No se pudo conectar.', res.status);
  return data as T;
}

/** Foto más liviana para compartir: máx. 1280 px, JPEG. */
async function shareImageBytes(dataUrl: string): Promise<Uint8Array<ArrayBuffer>> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo preparar la foto'))), 'image/jpeg', 0.8),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

export async function createShare(state: State): Promise<ShareLink> {
  if (!state.image) throw new ShareError('Primero sube una foto.', 400);
  const { key, raw } = await newKey();
  const [img, payload] = await Promise.all([
    shareImageBytes(state.image).then((bytes) => encrypt(key, bytes)),
    encryptJson(key, toShared(state)),
  ]);
  const res = await request<{ id: string; token: string }>('/api/share', {
    method: 'POST',
    body: JSON.stringify({ img, state: payload }),
  });
  return { id: res.id, key: raw, token: res.token };
}

export async function pushShare(link: ShareLink, state: State): Promise<number> {
  const key = await importKey(link.key);
  const payload = await encryptJson(key, toShared(state));
  const res = await request<{ v: number }>(
    `/api/share/${link.id}`,
    { method: 'PUT', body: JSON.stringify({ state: payload }) },
    link.token,
  );
  return res.v;
}

export async function deleteShare(link: ShareLink): Promise<void> {
  await request(`/api/share/${link.id}`, { method: 'DELETE' }, link.token);
}

function bytesToDataUrl(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
  });
}

export interface Loaded {
  state: SharedState;
  v: number;
  /** data: URL de la foto (solo si se pidió). */
  image?: string;
  canEdit?: boolean;
}

/** Descarga y descifra. Con `withImage` trae también la foto. */
export async function loadShare(
  link: { id: string; key: string; token?: string },
  withImage: boolean,
): Promise<Loaded> {
  const res = await request<{ state: string; v: number; img?: string; canEdit?: boolean }>(
    `/api/share/${link.id}${withImage ? '?img=1' : ''}`,
    {},
    link.token,
  );
  const key = await importKey(link.key);
  let state: SharedState;
  let image: string | undefined;
  try {
    state = await decryptJson<SharedState>(key, res.state);
    if (withImage && res.img) image = await bytesToDataUrl(await decrypt(key, res.img));
  } catch {
    throw new ShareError('El link está incompleto o dañado.', 400);
  }
  return { state, v: res.v, image, canEdit: res.canEdit };
}
