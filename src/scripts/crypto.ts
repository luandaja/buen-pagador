const IV_LENGTH = 12;
const ENCODE_CHUNK_SIZE = 0x8000;

export function toB64url(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += ENCODE_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + ENCODE_CHUNK_SIZE));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function newKey(): Promise<{ key: CryptoKey; raw: string }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  return { key, raw: toB64url(rawKey) };
}

export function importKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromB64url(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  const payload = new Uint8Array(iv.length + ciphertext.length);
  payload.set(iv);
  payload.set(ciphertext, iv.length);
  return toB64url(payload);
}

export async function decrypt(key: CryptoKey, payload: string): Promise<Uint8Array> {
  const bytes = fromB64url(payload);
  const iv = bytes.subarray(0, IV_LENGTH);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.subarray(IV_LENGTH));
  return new Uint8Array(plaintext);
}

export function encryptJson(key: CryptoKey, value: unknown): Promise<string> {
  return encrypt(key, new TextEncoder().encode(JSON.stringify(value)));
}

export async function decryptJson<T>(key: CryptoKey, payload: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await decrypt(key, payload)));
}
