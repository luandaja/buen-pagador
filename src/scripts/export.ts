import { es } from '../i18n/es';
import { loadImage } from './image';
import { computeTotals, money, type Face, type State, type Totals } from './state';

type Context = CanvasRenderingContext2D;
type Box = { x: number; y: number; w: number; h: number };
export type CardInput = Pick<State, 'image' | 'faces' | 'cost' | 'currency' | 'title' | 'rounding' | 'includePhoto'> &
  Partial<Pick<State, 'payNote' | 'payQr'>>;

const COLORS = {
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

export const SIZE = 1080;
const PAD = 56;
const CONTENT_W = SIZE - PAD * 2;
const THERMO_W = 170;
const GAP = 32;

export const LAYOUT = (() => {
  const statsH = 136;
  const statsTop = SIZE - PAD + 16 - statsH;
  const footerBaseline = statsTop - 34;
  const bodyTop = 218;
  const bodyBottom = footerBaseline - 64;
  return { statsH, statsTop, footerBaseline, bodyTop, bodyH: bodyBottom - bodyTop };
})();

const MIN_FONT_SIZE = 24;

function roundRect(ctx: Context, x: number, y: number, width: number, height: number, radii: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radii);
}

export function fitText(ctx: Context, text: string, maxWidth: number, size: number, weight: number, family: string) {
  let fontSize = size;
  ctx.font = `${weight} ${fontSize}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && fontSize > MIN_FONT_SIZE) {
    fontSize -= 2;
    ctx.font = `${weight} ${fontSize}px ${family}`;
  }
  return fontSize;
}

export function containBox(aspectRatio: number, box: Box): Box {
  const width = Math.min(box.w, box.h * aspectRatio);
  const height = width / aspectRatio;
  return { x: box.x + (box.w - width) / 2, y: box.y + (box.h - height) / 2, w: width, h: height };
}

export function statusLine(totals: Totals): { text: string; done: boolean } {
  const pending = totals.people - totals.paid;
  if (totals.people === 0) return { text: es.card.noPlayers, done: false };
  if (pending === 0) return { text: es.card.settled, done: true };
  return { text: es.card.pending(Math.round(totals.paidRatio * 100), pending), done: false };
}

export function statCells(state: Pick<State, 'cost' | 'currency'>, totals: Totals): [string, string][] {
  return [
    [es.card.stats.cost, money(state.cost, state.currency)],
    [es.card.stats.share, money(totals.share, state.currency)],
    [es.card.stats.paid, `${totals.paid}/${totals.people}`],
    [es.card.stats.missing, money(totals.missing, state.currency)],
  ];
}

function drawBall(ctx: Context, centerX: number, centerY: number, radius: number) {
  ctx.save();
  ctx.fillStyle = COLORS.ball;
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = radius * 0.1;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(centerX - radius, centerY);
  ctx.lineTo(centerX + radius, centerY);
  ctx.moveTo(centerX, centerY - radius);
  ctx.lineTo(centerX, centerY + radius);
  const scale = radius / 46;
  for (const side of [-1, 1]) {
    ctx.moveTo(centerX + side * 32 * scale, centerY - 32 * scale);
    ctx.bezierCurveTo(centerX + side * 14 * scale, centerY - 16 * scale, centerX + side * 14 * scale, centerY + 16 * scale, centerX + side * 32 * scale, centerY + 32 * scale);
  }
  ctx.stroke();
  ctx.restore();
}

function drawThermo(ctx: Context, box: Box, paidRatio: number) {
  const tubeW = 56;
  const bulbR = 62;
  const centerX = box.x + box.w / 2 + 18;
  const tubeBottom = box.y + box.h - bulbR * 1.6;
  const tubeH = tubeBottom - box.y;
  const radii = [tubeW / 2, tubeW / 2, 0, 0];

  roundRect(ctx, centerX - tubeW / 2, box.y, tubeW, tubeH + bulbR, radii);
  ctx.fillStyle = COLORS.track;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = COLORS.ink;
  ctx.stroke();

  const fillH = tubeH * Math.min(1, paidRatio);
  ctx.save();
  roundRect(ctx, centerX - tubeW / 2 + 3, box.y + 3, tubeW - 6, tubeH + bulbR, radii);
  ctx.clip();
  ctx.fillStyle = paidRatio >= 1 ? COLORS.paid : COLORS.ball;
  ctx.fillRect(centerX - tubeW / 2, tubeBottom - fillH, tubeW, fillH + bulbR);
  ctx.restore();

  ctx.font = `700 24px ${BODY}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.chalkDim;
  for (const mark of [25, 50, 75, 100]) {
    const markY = tubeBottom - (tubeH * mark) / 100;
    ctx.fillText(String(mark), centerX - tubeW / 2 - 22, markY);
    ctx.fillRect(centerX - tubeW / 2 - 16, markY - 1.5, 10, 3);
  }

  drawBall(ctx, centerX, box.y + box.h - bulbR, bulbR);
}

function drawPaidMark(ctx: Context, faceBox: Box) {
  const centerX = faceBox.x + faceBox.w / 2;
  const centerY = faceBox.y + faceBox.h / 2;
  const radius = (faceBox.w / 2) * 1.08;
  ctx.lineWidth = Math.max(4, faceBox.w * 0.045);
  ctx.strokeStyle = COLORS.paid;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();

  const badgeRadius = Math.max(12, faceBox.w * 0.17);
  const badgeX = centerX + radius * 0.72;
  const badgeY = centerY + radius * 0.72;
  ctx.fillStyle = COLORS.paid;
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = Math.max(3, badgeRadius * 0.28);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(badgeX - badgeRadius * 0.45, badgeY + badgeRadius * 0.02);
  ctx.lineTo(badgeX - badgeRadius * 0.1, badgeY + badgeRadius * 0.38);
  ctx.lineTo(badgeX + badgeRadius * 0.48, badgeY - badgeRadius * 0.32);
  ctx.stroke();
}

function drawEmoji(ctx: Context, faceBox: Box, emoji: string) {
  const size = faceBox.w * 1.18;
  ctx.font = `${size}px ${EMOJI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = size * 0.08;
  ctx.shadowOffsetY = size * 0.03;
  ctx.fillText(emoji, faceBox.x + faceBox.w / 2, faceBox.y + faceBox.h * 0.46 + size * 0.04);
  ctx.shadowColor = 'transparent';
}

function drawFace(ctx: Context, photo: Box, face: Face) {
  const box = { x: photo.x + face.x * photo.w, y: photo.y + face.y * photo.h, w: face.w * photo.w, h: face.h * photo.h };
  if (face.paid) drawPaidMark(ctx, box);
  else drawEmoji(ctx, box, face.emoji);
}

function drawPhoto(ctx: Context, photoImage: HTMLImageElement, faces: Face[], box: Box) {
  ctx.save();
  roundRect(ctx, box.x, box.y, box.w, box.h, 20);
  ctx.clip();
  ctx.drawImage(photoImage, box.x, box.y, box.w, box.h);
  for (const face of faces) drawFace(ctx, box, face);
  ctx.restore();

  ctx.lineWidth = 8;
  ctx.strokeStyle = COLORS.chalk;
  roundRect(ctx, box.x, box.y, box.w, box.h, 20);
  ctx.stroke();
}

function drawPercent(ctx: Context, state: CardInput, totals: Totals, box: Box) {
  const percentText = `${Math.round(totals.paidRatio * 100)}%`;
  ctx.textAlign = 'left';
  ctx.fillStyle = totals.paidRatio >= 1 ? COLORS.paid : COLORS.chalk;
  const fontSize = fitText(ctx, percentText, box.w, 280, 900, DISPLAY);
  const baseline = box.y + box.h / 2 + fontSize * 0.3;
  ctx.fillText(percentText, box.x, baseline);
  ctx.font = `600 40px ${BODY}`;
  ctx.fillStyle = COLORS.chalkDim;
  ctx.fillText(es.card.collectedOf(money(totals.collected, state.currency), money(state.cost, state.currency)), box.x + 6, baseline + 64);
}

function drawBackground(ctx: Context) {
  const gradient = ctx.createRadialGradient(SIZE / 2, 0, 0, SIZE / 2, 0, SIZE);
  gradient.addColorStop(0.4, COLORS.court);
  gradient.addColorStop(1, COLORS.courtShade);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 4;
  const courtArcs: [number, number, number, number][] = [
    [SIZE, 220, Math.PI, 0],
    [SIZE, 80, Math.PI, 0],
    [0, 220, 0, Math.PI],
  ];
  for (const [centerY, radius, startAngle, endAngle] of courtArcs) {
    ctx.beginPath();
    ctx.arc(SIZE / 2, centerY, radius, startAngle, endAngle);
    ctx.stroke();
  }
}

function drawHeader(ctx: Context, title: string) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.chalkDim;
  ctx.font = `700 24px ${BODY}`;
  ctx.fillText(es.card.brand, PAD, PAD + 24);

  const text = (title.trim() || es.card.defaultTitle).toUpperCase();
  const size = fitText(ctx, text, CONTENT_W, 96, 900, DISPLAY);
  ctx.fillStyle = COLORS.chalk;
  ctx.fillText(text, PAD, PAD + 36 + size * 0.86);
}

function drawStatus(ctx: Context, totals: Totals) {
  const { text, done } = statusLine(totals);
  ctx.textAlign = 'center';
  ctx.fillStyle = done ? COLORS.paid : COLORS.chalk;
  fitText(ctx, text, CONTENT_W, 52, 800, DISPLAY);
  ctx.fillText(text, SIZE / 2, LAYOUT.footerBaseline);
}

function drawStats(ctx: Context, cells: [string, string][]) {
  const { statsTop: top, statsH: height } = LAYOUT;
  roundRect(ctx, PAD, top, CONTENT_W, height, 22);
  ctx.fillStyle = COLORS.ink;
  ctx.fill();
  const cellWidth = CONTENT_W / cells.length;
  ctx.textAlign = 'center';
  cells.forEach(([label, value], index) => {
    const centerX = PAD + cellWidth * index + cellWidth / 2;
    ctx.fillStyle = 'rgba(247,248,252,0.12)';
    if (index > 0) ctx.fillRect(PAD + cellWidth * index, top + 24, 2, height - 48);
    ctx.fillStyle = COLORS.chalkDim;
    ctx.font = `700 22px ${BODY}`;
    ctx.fillText(label, centerX, top + 48);
    ctx.fillStyle = index === 1 ? COLORS.ball : COLORS.chalk;
    fitText(ctx, value, cellWidth - 24, 60, 800, DISPLAY);
    ctx.fillText(value, centerX, top + 108);
  });
}

async function loadFonts() {
  await document.fonts.ready;
  const fontSpecs = [`900 64px ${DISPLAY}`, `800 64px ${DISPLAY}`, `600 24px ${BODY}`, `700 24px ${BODY}`];
  await Promise.all(fontSpecs.map((fontSpec) => document.fonts.load(fontSpec))).catch(() => {});
}

const NOTE_H = 52;
const QR_LABEL_H = 64;

export function bodyBoxes(hasNote: boolean, hasQr: boolean) {
  const top = LAYOUT.bodyTop + (hasNote ? NOTE_H : 0);
  const height = LAYOUT.bodyH - (hasNote ? NOTE_H : 0);
  const thermoX = SIZE - PAD - THERMO_W;
  const qrBox: Box | null = hasQr ? { x: thermoX, y: top, w: THERMO_W, h: THERMO_W } : null;
  const shift = qrBox ? THERMO_W + QR_LABEL_H : 0;
  return {
    noteBaseline: LAYOUT.bodyTop + 30,
    left: { x: PAD, y: top, w: CONTENT_W - THERMO_W - GAP, h: height },
    thermo: { x: thermoX, y: top + shift, w: THERMO_W, h: height - shift },
    qr: qrBox,
  };
}

function drawPayNote(ctx: Context, note: string, baseline: number) {
  const text = es.card.payNote(note);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.ball;
  fitText(ctx, text, CONTENT_W, 30, 700, BODY);
  ctx.fillText(text, PAD, baseline);
}

function drawQr(ctx: Context, qrImage: HTMLImageElement, box: Box) {
  roundRect(ctx, box.x, box.y, box.w, box.h, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  const inner = containBox(qrImage.naturalWidth / qrImage.naturalHeight, { x: box.x + 10, y: box.y + 10, w: box.w - 20, h: box.h - 20 });
  ctx.drawImage(qrImage, inner.x, inner.y, inner.w, inner.h);
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.chalkDim;
  ctx.font = `700 18px ${BODY}`;
  ctx.fillText(es.card.scanToPay, box.x + box.w / 2, box.y + box.h + 24);
}

const loadImageIf = (src: string | null | undefined, wanted = true) => (src && wanted ? loadImage(src) : null);

function drawBody(ctx: Context, state: CardInput, totals: Totals, photoImage: HTMLImageElement | null, qrImage: HTMLImageElement | null) {
  const note = state.payNote?.trim() ?? '';
  const boxes = bodyBoxes(!!note, !!qrImage);
  if (note) drawPayNote(ctx, note, boxes.noteBaseline);
  if (photoImage) drawPhoto(ctx, photoImage, state.faces, containBox(photoImage.naturalWidth / photoImage.naturalHeight, boxes.left));
  else drawPercent(ctx, state, totals, boxes.left);
  if (qrImage && boxes.qr) drawQr(ctx, qrImage, boxes.qr);
  drawThermo(ctx, boxes.thermo, totals.paidRatio);
}

export async function renderCard(state: CardInput): Promise<HTMLCanvasElement> {
  await loadFonts();
  const totals = computeTotals(state);
  const [photoImage, qrImage] = await Promise.all([loadImageIf(state.image, state.includePhoto), loadImageIf(state.payQr)]);

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;

  drawBackground(ctx);
  drawHeader(ctx, state.title);
  drawBody(ctx, state, totals, photoImage, qrImage);
  drawStatus(ctx, totals);
  drawStats(ctx, statCells(state, totals));
  return canvas;
}
