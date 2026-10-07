// Cliente de links compartidos: arma los links, cifra y habla con /api/share.
import { decrypt, decryptJson, encrypt, encryptJson, importKey, newKey } from './crypto';
import { bytesToDataUrl, shareImageBytes } from './image';
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

const errorText = (data: { error?: string }) => data.error ?? 'No se pudo conectar.';

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ShareError(errorText(data), res.status);
  return data as T;
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

export interface Loaded {
  state: SharedState;
  v: number;
  /** data: URL de la foto (solo si se pidió). */
  image?: string;
  canEdit?: boolean;
}

type RawShare = { state: string; v: number; img?: string; canEdit?: boolean };

async function decryptShare(key: CryptoKey, res: RawShare): Promise<Loaded> {
  const state = await decryptJson<SharedState>(key, res.state);
  const image = res.img ? await bytesToDataUrl(await decrypt(key, res.img)) : undefined;
  return { state, v: res.v, image, canEdit: res.canEdit };
}

/** Descarga y descifra. Con `withImage` trae también la foto. */
/** Lo necesario para leer un link: id y clave; con token, además se sabe si puede editar. */
export type LinkRef = { id: string; key: string; token?: string };

export async function loadShare(link: LinkRef, withImage: boolean): Promise<Loaded> {
  const query = withImage ? '?img=1' : '';
  const res = await request<RawShare>(`/api/share/${link.id}${query}`, {}, link.token);
  try {
    return await decryptShare(await importKey(link.key), res);
  } catch {
    throw new ShareError('El link está incompleto o dañado.', 400);
  }
}
