import { describe, expect, it } from 'vitest';
import { applyPalette, CHALK, contrast, darken, paletteById, paletteVars, PALETTES } from '../src/scripts/palettes';

const AA_TEXT = 4.5;

describe('palettes', () => {
  it.each(PALETTES)('$name keeps every text pair at WCAG AA', (palette) => {
    expect(contrast(CHALK, palette.court)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(CHALK, palette.ink)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(palette.ink, palette.ball)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(palette.paid, palette.ink)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(palette.warn, palette.ink)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('measures contrast like WCAG', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
  });

  it('keeps the original court shades and derives darker ones for the rest', () => {
    expect(paletteVars(paletteById('cancha'))).toMatchObject({ court: '#2340c8', 'court-deep': '#172a93', 'court-shade': '#1b33ad' });
    expect(paletteVars(paletteById('playa'))['court-deep']).toBe(darken('#0e6b73', 0.3));
    expect(darken('#ffffff', 0.5)).toBe('#808080');
    expect(paletteById('unknown').id).toBe('cancha');
  });

  it('applies the tokens and theme color to the page', () => {
    document.head.innerHTML = '<meta name="theme-color" content="#2340C8" />';
    applyPalette('noche');
    const root = document.documentElement;
    expect(root.dataset.palette).toBe('noche');
    expect(root.style.getPropertyValue('--court')).toBe('#3b2a8c');
    expect(root.style.getPropertyValue('--ball')).toBe('#ff7ac3');
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe('#3b2a8c');
    document.head.innerHTML = '';
    applyPalette('cancha');
    expect(root.dataset.palette).toBe('cancha');
  });
});
