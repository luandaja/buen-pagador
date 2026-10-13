export interface Palette {
  id: string;
  name: string;
  court: string;
  ink: string;
  ball: string;
  paid: string;
  warn: string;
}

export const PALETTES: Palette[] = [
  { id: 'cancha', name: 'Cancha', court: '#2340c8', ink: '#0d1238', ball: '#ff6a13', paid: '#1fcb7a', warn: '#ffa071' },
  { id: 'playa', name: 'Playa', court: '#0e6b73', ink: '#06272b', ball: '#ffc23d', paid: '#5eead4', warn: '#ffa98a' },
  { id: 'selva', name: 'Selva', court: '#2c5e3f', ink: '#0c1f14', ball: '#f2a541', paid: '#a3e66b', warn: '#ff9f80' },
  { id: 'noche', name: 'Noche', court: '#3b2a8c', ink: '#120c2e', ball: '#ff7ac3', paid: '#4ee0a5', warn: '#ffab91' },
  { id: 'atardecer', name: 'Atardecer', court: '#a3361c', ink: '#2b0d06', ball: '#ffd84d', paid: '#8ff0a4', warn: '#ffc08a' },
  { id: 'grafito', name: 'Grafito', court: '#34343c', ink: '#121216', ball: '#b8f04a', paid: '#5be08f', warn: '#ffa26b' },
];

export const CHALK = '#f7f8fc';

const ORIGINAL_SHADES = { 'court-deep': '#172a93', 'court-shade': '#1b33ad' };

export const paletteById = (id: string) => PALETTES.find((palette) => palette.id === id) ?? PALETTES[0];

const channels = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));

export function darken(hex: string, amount: number): string {
  return `#${channels(hex)
    .map((value) => Math.round(value * (1 - amount)).toString(16).padStart(2, '0'))
    .join('')}`;
}

function luminance(hex: string): number {
  const [red, green, blue] = channels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrast(first: string, second: string): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

export function paletteVars(palette: Palette): Record<string, string> {
  const shades = palette.id === 'cancha' ? ORIGINAL_SHADES : { 'court-deep': darken(palette.court, 0.3), 'court-shade': darken(palette.court, 0.13) };
  return { court: palette.court, ink: palette.ink, ball: palette.ball, paid: palette.paid, warn: palette.warn, ...shades };
}

export function applyPalette(id: string, root: HTMLElement = document.documentElement) {
  const palette = paletteById(id);
  for (const [name, value] of Object.entries(paletteVars(palette))) root.style.setProperty(`--${name}`, value);
  root.dataset.palette = palette.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.court);
}
