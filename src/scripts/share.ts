import { decrypt, decryptJson, encrypt, encryptJson, importKey, newKey } from './crypto';
import { es } from '../i18n/es';
import { bytesToDataUrl, shareImageBytes } from './image';
import { expiresAtFrom } from './links';
import { PUBLIC_PATH } from './routes';
import { computeTotals, type Face, type Game, type State } from './state';

export interface ShareLink {
  id: string;
  key: string;
  token: string;
  expiresAt?: number;
}

export const SCHEMA_VERSION = 1;

export interface SharedState {
  schemaVersion: number;
  title: string;
  cost: number | null;
  quota: number | null;
  hideTotal: boolean;
  currency: string;
  rounding: number;
  faces: Face[];
}

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

const EDIT_PREFIX = 'edit';
const LEGACY_EDIT_PREFIX = 'editar';
const MASTER_HASH = new RegExp(`^#(?:${EDIT_PREFIX}|${LEGACY_EDIT_PREFIX})=([A-Za-z0-9]{10})\\.([\\w-]{43})\\.([\\w-]{32})$`);
const PUBLIC_HASH = /^#([A-Za-z0-9]{10})\.([\w-]{43})$/;

export function publicUrl(link: Pick<ShareLink, 'id' | 'key'>): string {
  return `${location.origin}${PUBLIC_PATH}#${link.id}.${link.key}`;
}

export function masterUrl(link: ShareLink): string {
  return `${location.origin}/#${EDIT_PREFIX}=${link.id}.${link.key}.${link.token}`;
}

export function parsePublicHash(hash: string): { id: string; key: string } | null {
  const match = hash.match(PUBLIC_HASH);
  return match ? { id: match[1], key: match[2] } : null;
}

export function parseMasterHash(hash: string): ShareLink | null {
  const match = hash.match(MASTER_HASH);
  return match ? { id: match[1], key: match[2], token: match[3] } : null;
}

const COORDINATE_PRECISION = 10000;
const roundCoordinate = (value: number) => Math.round(value * COORDINATE_PRECISION) / COORDINATE_PRECISION;

export function toShared(state: State): SharedState {
  // A hidden total never leaves the device: the link carries only the share each person pays.
  const hidden = state.hideTotal;
  return {
    schemaVersion: SCHEMA_VERSION,
    title: state.title,
    cost: hidden ? null : state.cost,
    quota: hidden ? computeTotals(state).share : state.quota,
    hideTotal: hidden,
    currency: state.currency,
    rounding: state.rounding,
    faces: state.faces.map((face) => ({
      ...face,
      x: roundCoordinate(face.x),
      y: roundCoordinate(face.y),
      w: roundCoordinate(face.w),
      h: roundCoordinate(face.h),
    })),
  };
}

// With the total hidden the link has no cost and a derived quota, so a device that already knows them keeps its own.
export function fromShared(shared: SharedState, local: Pick<Game, 'cost' | 'quota'>): Partial<Game> {
  const { schemaVersion, cost, quota, ...fields } = shared;
  const keepLocal = shared.hideTotal && (local.cost != null || local.quota != null);
  return keepLocal ? fields : { ...fields, cost, quota };
}

const errorText = (body: { error?: string }) => es.errors[body.error ?? 'network'] ?? es.errors.network;

export async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(path, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ShareError(errorText(body), response.status);
  return body as T;
}

export async function createShare(state: State): Promise<ShareLink> {
  const { key, raw } = await newKey();
  const pay = payOf(state);
  const [encryptedImage, encryptedState, encryptedPay] = await Promise.all([
    state.image ? shareImageBytes(state.image).then((bytes) => encrypt(key, bytes)) : undefined,
    encryptJson(key, toShared(state)),
    hasPay(pay) ? encryptJson(key, pay) : undefined,
  ]);
  const created = await request<{ id: string; token: string; ttl?: number }>('/api/share', {
    method: 'POST',
    body: JSON.stringify({ img: encryptedImage, state: encryptedState, pay: encryptedPay }),
  });
  return { id: created.id, key: raw, token: created.token, expiresAt: expiresAtFrom(created.ttl) };
}

export async function pushShare(link: ShareLink, state: State, withPay = false): Promise<{ v: number; expiresAt?: number }> {
  const key = await importKey(link.key);
  const [encryptedState, encryptedPay] = await Promise.all([
    encryptJson(key, toShared(state)),
    withPay ? encryptJson(key, payOf(state)) : undefined,
  ]);
  const updated = await request<{ v: number; ttl?: number }>(
    `/api/share/${link.id}`,
    { method: 'PUT', body: JSON.stringify({ state: encryptedState, pay: encryptedPay }) },
    link.token,
  );
  return { v: updated.v, expiresAt: expiresAtFrom(updated.ttl) };
}

export async function deleteShare(link: ShareLink): Promise<void> {
  await request(`/api/share/${link.id}`, { method: 'DELETE' }, link.token);
}

export interface Loaded {
  state: SharedState;
  v: number;
  image?: string;
  canEdit?: boolean;
  pay?: PayInfo;
  pv: number;
  expiresAt?: number;
}

type RawShare = { state: string; v: number; pv?: number; img?: string; pay?: string; canEdit?: boolean; ttl?: number };

async function decryptShare(key: CryptoKey, encrypted: RawShare): Promise<Loaded> {
  const state = { schemaVersion: 1, quota: null, hideTotal: false, ...(await decryptJson<Partial<SharedState>>(key, encrypted.state)) } as SharedState;
  const image = encrypted.img ? await bytesToDataUrl(await decrypt(key, encrypted.img)) : undefined;
  const pay = encrypted.pay ? await decryptJson<PayInfo>(key, encrypted.pay) : undefined;
  return { state, v: encrypted.v, pv: encrypted.pv ?? 0, image, pay, canEdit: encrypted.canEdit, expiresAt: expiresAtFrom(encrypted.ttl) };
}

export type LinkRef = { id: string; key: string; token?: string };

export async function loadShare(link: LinkRef, withImage: boolean, withPay = false): Promise<Loaded> {
  const query = withImage ? '?img=1' : withPay ? '?pay=1' : '';
  const encrypted = await request<RawShare>(`/api/share/${link.id}${query}`, {}, link.token);
  try {
    return await decryptShare(await importKey(link.key), encrypted);
  } catch {
    throw new ShareError(es.errors.broken, 400);
  }
}
