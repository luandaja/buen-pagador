// Dibuja la tarjeta para compartir (1080×1080) directamente en un canvas.
import { loadImage } from './image';
import { computeTotals, money, type Face, type State, type Totals } from './state';

type Ctx = CanvasRenderingContext2D;
type Box = { x: number; y: number; w: number; h: number };
/** Lo que necesita la tarjeta: datos del partido y si va con foto. */
export type CardInput = Pick<State, 'image' | 'faces' | 'cost' | 'currency' | 'title' | 'rounding' | 'includePhoto'>;

const C = {
  court: '#2340c8',
  courtShade: '#1b33ad',
  chalk: '#f7f8fc',
  chalkDim: 'rgba(247,248,252,0.72)',
  line: 'rgba(247,248,252,0.16)',
  ball: '#ff6a13',
  ink: '#0d1238',
  paid: '#1fcb7a',
  track: '#e4e7f4',
};

const DISPLAY = '"Big Shoulders Display", "Arial Narrow", Impact, sans-serif';
const BODY = '"Familjen Grotesk", system-ui, sans-serif';
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** Formato cuadrado 1:1 (ideal para WhatsApp e Instagram). */
export const SIZE = 1080;
const PAD = 56;
const CONTENT_W = SIZE - PAD * 2;
const THERMO_W = 170;
const GAP = 32;

/** Zonas verticales fijas de la tarjeta. */
export const LAYOUT = (() => {
  const statsH = 136;
  const statsTop = SIZE - PAD + 16 - statsH;
  const footerBaseline = statsTop - 34;
  const bodyTop = 218;
  const bodyBottom = footerBaseline - 64;
  return { statsH, statsTop, footerBaseline, bodyTop, bodyH: bodyBottom - bodyTop };
})();

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Reduce la fuente hasta que el texto quepa en `maxWidth` (mínimo 24 px). */
export function fitText(ctx: Ctx, text: string, maxWidth: number, size: number, weight: number, family: string) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && s > 24) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

/** Encaja una foto de proporción `ar` dentro de una caja, centrada. */
export function containBox(ar: number, box: Box): Box {
  const w = Math.min(box.w, box.h * ar);
  const h = w / ar;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** Frase de estado bajo la foto. */
export function statusLine(t: Totals): { text: string; done: boolean } {
  const pending = t.people - t.paid;
  if (t.people === 0) return { text: 'SIN JUGADORES TODAVÍA', done: false };
  if (pending === 0) return { text: '¡CANCHA PAGADA! GRACIAS, BUENOS PAGADORES', done: true };
  const who = pending === 1 ? 'FALTA 1 PERSONA' : `FALTAN ${pending} PERSONAS`;
  return { text: `${Math.round(t.pct * 100)}% PAGADO · ${who}`, done: false };
}

export function statCells(state: Pick<State, 'cost' | 'currency'>, t: Totals): [string, string][] {
  return [
    ['CANCHA', money(state.cost, state.currency)],
    ['CUOTA', money(t.share, state.currency)],
    ['PAGARON', `${t.paid}/${t.people}`],
    ['FALTA', money(t.missing, state.currency)],
  ];
}

function drawBall(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.fillStyle = C.ball;
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = r * 0.1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  const k = r / 46;
  for (const side of [-1, 1]) {
    ctx.moveTo(cx + side * 32 * k, cy - 32 * k);
    ctx.bezierCurveTo(cx + side * 14 * k, cy - 16 * k, cx + side * 14 * k, cy + 16 * k, cx + side * 32 * k, cy + 32 * k);
  }
  ctx.stroke();
  ctx.restore();
}

function drawThermo(ctx: Ctx, box: Box, pct: number) {
  const tubeW = 56;
  const bulbR = 62;
  const cx = box.x + box.w / 2 + 18;
  const tubeBottom = box.y + box.h - bulbR * 1.6;
  const tubeH = tubeBottom - box.y;
  const radii = [tubeW / 2, tubeW / 2, 0, 0];

  roundRect(ctx, cx - tubeW / 2, box.y, tubeW, tubeH + bulbR, radii);
  ctx.fillStyle = C.track;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = C.ink;
  ctx.stroke();

  const fillH = tubeH * Math.min(1, pct);
  ctx.save();
  roundRect(ctx, cx - tubeW / 2 + 3, box.y + 3, tubeW - 6, tubeH + bulbR, radii);
  ctx.clip();
  ctx.fillStyle = pct >= 1 ? C.paid : C.ball;
  ctx.fillRect(cx - tubeW / 2, tubeBottom - fillH, tubeW, fillH + bulbR);
  ctx.restore();

  ctx.font = `700 24px ${BODY}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.chalkDim;
  for (const p of [25, 50, 75, 100]) {
    const ty = tubeBottom - (tubeH * p) / 100;
    ctx.fillText(String(p), cx - tubeW / 2 - 22, ty);
    ctx.fillRect(cx - tubeW / 2 - 16, ty - 1.5, 10, 3);
  }

  drawBall(ctx, cx, box.y + box.h - bulbR, bulbR);
}

function drawPaidMark(ctx: Ctx, f: Box) {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  const r = (f.w / 2) * 1.08;
  ctx.lineWidth = Math.max(4, f.w * 0.045);
  ctx.strokeStyle = C.paid;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  const br = Math.max(12, f.w * 0.17);
  const bx = cx + r * 0.72;
  const by = cy + r * 0.72;
  ctx.fillStyle = C.paid;
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = Math.max(3, br * 0.28);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(bx - br * 0.45, by + br * 0.02);
  ctx.lineTo(bx - br * 0.1, by + br * 0.38);
  ctx.lineTo(bx + br * 0.48, by - br * 0.32);
  ctx.stroke();
}

function drawEmoji(ctx: Ctx, f: Box, emoji: string) {
  const size = f.w * 1.18;
  ctx.font = `${size}px ${EMOJI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = size * 0.08;
  ctx.shadowOffsetY = size * 0.03;
  ctx.fillText(emoji, f.x + f.w / 2, f.y + f.h * 0.46 + size * 0.04);
  ctx.shadowColor = 'transparent';
}

function drawFace(ctx: Ctx, photo: Box, face: Face) {
  const box = { x: photo.x + face.x * photo.w, y: photo.y + face.y * photo.h, w: face.w * photo.w, h: face.h * photo.h };
  if (face.paid) drawPaidMark(ctx, box);
  else drawEmoji(ctx, box, face.emoji);
}

function drawPhoto(ctx: Ctx, img: HTMLImageElement, faces: Face[], box: Box) {
  ctx.save();
  roundRect(ctx, box.x, box.y, box.w, box.h, 20);
  ctx.clip();
  ctx.drawImage(img, box.x, box.y, box.w, box.h);
  for (const face of faces) drawFace(ctx, box, face);
  ctx.restore();

  ctx.lineWidth = 8;
  ctx.strokeStyle = C.chalk;
  roundRect(ctx, box.x, box.y, box.w, box.h, 20);
  ctx.stroke();
}

/** Sin foto: porcentaje enorme y lo recaudado. */
function drawPercent(ctx: Ctx, state: CardInput, t: Totals, box: Box) {
  const pctText = `${Math.round(t.pct * 100)}%`;
  ctx.textAlign = 'left';
  ctx.fillStyle = t.pct >= 1 ? C.paid : C.chalk;
  const s = fitText(ctx, pctText, box.w, 280, 900, DISPLAY);
  const baseline = box.y + box.h / 2 + s * 0.3;
  ctx.fillText(pctText, box.x, baseline);
  ctx.font = `600 40px ${BODY}`;
  ctx.fillStyle = C.chalkDim;
  ctx.fillText(`${money(t.collected, state.currency)} de ${money(state.cost, state.currency)}`, box.x + 6, baseline + 64);
}

function drawBackground(ctx: Ctx) {
  const bg = ctx.createRadialGradient(SIZE / 2, 0, 0, SIZE / 2, 0, SIZE);
  bg.addColorStop(0.4, C.court);
  bg.addColorStop(1, C.courtShade);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 4;
  const arcs: [number, number, number, number][] = [
    [SIZE, 220, Math.PI, 0],
    [SIZE, 80, Math.PI, 0],
    [0, 220, 0, Math.PI],
  ];
  for (const [cy, r, a0, a1] of arcs) {
    ctx.beginPath();
    ctx.arc(SIZE / 2, cy, r, a0, a1);
    ctx.stroke();
  }
}

function drawHeader(ctx: Ctx, title: string) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.chalkDim;
  ctx.font = `700 24px ${BODY}`;
  ctx.fillText('EL BUEN PAGADOR', PAD, PAD + 24);

  const text = (title.trim() || 'La cancha').toUpperCase();
  const size = fitText(ctx, text, CONTENT_W, 96, 900, DISPLAY);
  ctx.fillStyle = C.chalk;
  ctx.fillText(text, PAD, PAD + 36 + size * 0.86);
}

function drawStatus(ctx: Ctx, t: Totals) {
  const { text, done } = statusLine(t);
  ctx.textAlign = 'center';
  ctx.fillStyle = done ? C.paid : C.chalk;
  fitText(ctx, text, CONTENT_W, 52, 800, DISPLAY);
  ctx.fillText(text, SIZE / 2, LAYOUT.footerBaseline);
}

function drawStats(ctx: Ctx, cells: [string, string][]) {
  const { statsTop: top, statsH: h } = LAYOUT;
  roundRect(ctx, PAD, top, CONTENT_W, h, 22);
  ctx.fillStyle = C.ink;
  ctx.fill();
  const cellW = CONTENT_W / cells.length;
  ctx.textAlign = 'center';
  cells.forEach(([label, value], i) => {
    const cx = PAD + cellW * i + cellW / 2;
    ctx.fillStyle = 'rgba(247,248,252,0.12)';
    if (i > 0) ctx.fillRect(PAD + cellW * i, top + 24, 2, h - 48);
    ctx.fillStyle = C.chalkDim;
    ctx.font = `700 22px ${BODY}`;
    ctx.fillText(label, cx, top + 48);
    ctx.fillStyle = i === 1 ? C.ball : C.chalk;
    fitText(ctx, value, cellW - 24, 60, 800, DISPLAY);
    ctx.fillText(value, cx, top + 108);
  });
}

async function loadFonts() {
  await document.fonts.ready;
  const faces = [`900 64px ${DISPLAY}`, `800 64px ${DISPLAY}`, `600 24px ${BODY}`, `700 24px ${BODY}`];
  await Promise.all(faces.map((f) => document.fonts.load(f))).catch(() => {});
}

export async function renderCard(state: CardInput): Promise<HTMLCanvasElement> {
  await loadFonts();
  const t = computeTotals(state);
  const img = state.includePhoto && state.image ? await loadImage(state.image) : null;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  const left: Box = { x: PAD, y: LAYOUT.bodyTop, w: CONTENT_W - THERMO_W - GAP, h: LAYOUT.bodyH };
  const thermo: Box = { x: SIZE - PAD - THERMO_W, y: LAYOUT.bodyTop, w: THERMO_W, h: LAYOUT.bodyH };

  drawBackground(ctx);
  drawHeader(ctx, state.title);
  if (img) drawPhoto(ctx, img, state.faces, containBox(img.naturalWidth / img.naturalHeight, left));
  else drawPercent(ctx, state, t, left);
  drawThermo(ctx, thermo, t.pct);
  drawStatus(ctx, t);
  drawStats(ctx, statCells(state, t));
  return canvas;
}
