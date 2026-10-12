import { es } from '../i18n/es';

const DAY_MS = 24 * 60 * 60 * 1000;

export const expiresAtFrom = (ttlSeconds: number | undefined, now = Date.now()) => (ttlSeconds ? now + ttlSeconds * 1000 : undefined);

export const daysLeft = (expiresAt: number, now = Date.now()) => Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));

export function expiryText(expiresAt: number | undefined, now = Date.now()): string {
  return expiresAt ? es.links.expiry(daysLeft(expiresAt, now)) : '';
}
