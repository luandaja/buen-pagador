export const MAX_IMG = 1_500_000; // ~1.1 MB de foto cifrada en base64url
export const MAX_STATE = 64_000;

const B64URL = /^[A-Za-z0-9_-]+$/;
const ID = /^[A-Za-z0-9]{10}$/;

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function fail(status: number, message: string): Response {
  return json({ error: message }, status);
}

export async function readJson(request: Request, maxBytes: number): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

export function isPayload(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && B64URL.test(value);
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function randomId(length = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compara el token del header Authorization con el hash guardado. */
export async function canEdit(request: Request, editHash: string | undefined): Promise<boolean> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !editHash) return false;
  const hash = await sha256(token);
  if (hash.length !== editHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ editHash.charCodeAt(i);
  return diff === 0;
}
