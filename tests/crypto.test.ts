import { describe, expect, it } from 'vitest';
import { decrypt, decryptJson, encrypt, encryptJson, fromB64url, importKey, newKey, toB64url } from '../src/scripts/crypto';

describe('base64url', () => {
  it('ida y vuelta sin caracteres problemáticos para URLs', () => {
    const bytes = new Uint8Array([0, 251, 255, 62, 63, 1, 2]);
    const text = toB64url(bytes);
    expect(text).toMatch(/^[\w-]+$/);
    expect([...fromB64url(text)]).toEqual([...bytes]);
  });

  it('maneja datos grandes en bloques', () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(fromB64url(toB64url(big))).toEqual(big);
  });
});

describe('AES-GCM', () => {
  it('cifra y descifra con la clave exportada', async () => {
    const { key, raw } = await newKey();
    expect(raw).toHaveLength(43);
    const payload = await encryptJson(key, { hola: 'mundo' });
    const again = await importKey(raw);
    expect(await decryptJson(again, payload)).toEqual({ hola: 'mundo' });
  });

  it('usa un IV distinto en cada cifrado', async () => {
    const { key } = await newKey();
    const data = new Uint8Array([1, 2, 3]);
    expect(await encrypt(key, data)).not.toBe(await encrypt(key, data));
  });

  it('falla con otra clave', async () => {
    const a = await newKey();
    const b = await newKey();
    const payload = await encrypt(a.key, new Uint8Array([1, 2, 3]));
    await expect(decrypt(b.key, payload)).rejects.toThrow();
  });
});
