import { describe, expect, it } from 'vitest';
import { decrypt, decryptJson, encrypt, encryptJson, fromB64url, importKey, newKey, toB64url } from '../src/scripts/crypto';

describe('base64url', () => {
  it('round-trips without URL-unsafe characters', () => {
    const bytes = new Uint8Array([0, 251, 255, 62, 63, 1, 2]);
    const text = toB64url(bytes);
    expect(text).toMatch(/^[\w-]+$/);
    expect([...fromB64url(text)]).toEqual([...bytes]);
  });

  it('handles large data in chunks', () => {
    const big = new Uint8Array(100_000).map((_, index) => index % 256);
    expect(fromB64url(toB64url(big))).toEqual(big);
  });
});

describe('AES-GCM', () => {
  it('encrypts and decrypts with the exported key', async () => {
    const { key, raw } = await newKey();
    expect(raw).toHaveLength(43);
    const payload = await encryptJson(key, { hello: 'world' });
    const again = await importKey(raw);
    expect(await decryptJson(again, payload)).toEqual({ hello: 'world' });
  });

  it('uses a different IV each time', async () => {
    const { key } = await newKey();
    const data = new Uint8Array([1, 2, 3]);
    expect(await encrypt(key, data)).not.toBe(await encrypt(key, data));
  });

  it('fails with a different key', async () => {
    const firstKey = await newKey();
    const secondKey = await newKey();
    const payload = await encrypt(firstKey.key, new Uint8Array([1, 2, 3]));
    await expect(decrypt(secondKey.key, payload)).rejects.toThrow();
  });
});
