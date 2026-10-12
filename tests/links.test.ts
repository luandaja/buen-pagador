import { describe, expect, it } from 'vitest';
import { daysLeft, expiresAtFrom, expiryText } from '../src/scripts/links';

const DAY = 24 * 60 * 60 * 1000;

describe('link lifetime', () => {
  it('turns the server TTL into an expiry date', () => {
    expect(expiresAtFrom(60, 1000)).toBe(61_000);
    expect(expiresAtFrom(undefined)).toBeUndefined();
  });

  it('counts whole days left, never negative', () => {
    expect(daysLeft(10 * DAY, 0)).toBe(10);
    expect(daysLeft(DAY + 1, 0)).toBe(2);
    expect(daysLeft(0, DAY)).toBe(0);
  });

  it('explains the expiry in Spanish', () => {
    expect(expiryText(undefined)).toBe('');
    expect(expiryText(DAY, 0)).toBe('El link vence en 1 día si nadie lo cambia. Cada cambio lo renueva.');
    expect(expiryText(1, 1)).toBe('El link vence hoy. Cualquier cambio lo renueva.');
  });
});
