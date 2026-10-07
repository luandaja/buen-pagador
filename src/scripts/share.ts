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

/** Datos para pagar: viajan cifrados aparte del estado porque el QR pesa. */
export interface PayInfo {
  note: string;
  qr: string | null;
}

export const payOf = (state: Pick<State, 'payNote' | 'payQr'>): PayInfo => ({ note: state.payNote.trim(), qr: state.payQr });

export const hasPay = (pay: PayInfo) => !!(pay.note || pay.qr);

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
  const pay = payOf(state);
  const [img, payload, payData] = await Promise.all([
    shareImageBytes(state.image).then((bytes) => encrypt(key, bytes)),
    encryptJson(key, toShared(state)),
    hasPay(pay) ? encryptJson(key, pay) : undefined,
  ]);
  const res = await request<{ id: string; token: string }>('/api/share', {
    method: 'POST',
    body: JSON.stringify({ img, state: payload, pay: payData }),
  });
  return { id: res.id, key: raw, token: res.token };
}

/** Sube el estado; con `withPay` también los datos para pagar (solo cuando cambiaron). */
export async function pushShare(link: ShareLink, state: State, withPay = false): Promise<number> {
  const key = await importKey(link.key);
  const [payload, pay] = await Promise.all([encryptJson(key, toShared(state)), withPay ? encryptJson(key, payOf(state)) : undefined]);
  const res = await request<{ v: number }>(
    `/api/share/${link.id}`,
    { method: 'PUT', body: JSON.stringify({ state: payload, pay }) },
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
  /** Datos para pagar (si se pidieron y existen). */
  pay?: PayInfo;
  /** Versión de los datos para pagar. */
  pv: number;
}

type RawShare = { state: string; v: number; pv?: number; img?: string; pay?: string; canEdit?: boolean };

async function decryptShare(key: CryptoKey, res: RawShare): Promise<Loaded> {
  const state = await decryptJson<SharedState>(key, res.state);
  const image = res.img ? await bytesToDataUrl(await decrypt(key, res.img)) : undefined;
  const pay = res.pay ? await decryptJson<PayInfo>(key, res.pay) : undefined;
  return { state, v: res.v, pv: res.pv ?? 0, image, pay, canEdit: res.canEdit };
}

/** Lo necesario para leer un link: id y clave; con token, además se sabe si puede editar. */
export type LinkRef = { id: string; key: string; token?: string };

/** Descarga y descifra. Con `withImage` trae la foto (y los datos para pagar); con `withPay`, solo estos. */
export async function loadShare(link: LinkRef, withImage: boolean, withPay = false): Promise<Loaded> {
  const query = withImage ? '?img=1' : withPay ? '?pay=1' : '';
  const res = await request<RawShare>(`/api/share/${link.id}${query}`, {}, link.token);
  try {
    return await decryptShare(await importKey(link.key), res);
  } catch {
    throw new ShareError('El link está incompleto o dañado.', 400);
  }
}
