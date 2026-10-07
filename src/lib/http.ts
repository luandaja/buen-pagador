export const MAX_IMG = 1_500_000;
export const MAX_STATE = 64_000;
export const MAX_PAY = 400_000;

export const isOptionalPayload = (value: unknown, maxLength: number) => value === undefined || isPayload(value, maxLength);

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const ID_PATTERN = /^[A-Za-z0-9]{10}$/;
const BEARER_PREFIX = 'Bearer ';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function fail(status: number, errorCode: string): Response {
  return json({ error: errorCode }, status);
}

export async function readJson(request: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

export function isPayload(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && BASE64URL_PATTERN.test(value);
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function randomId(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length).trim() : '';
}

export function safeEqual(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export async function canEdit(request: Request, editHash: string | undefined): Promise<boolean> {
  const token = bearerToken(request);
  if (!token || !editHash) return false;
  return safeEqual(await sha256(token), editHash);
}
