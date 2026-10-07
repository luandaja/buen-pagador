// Dibuja la tarjeta para compartir directamente en un canvas.
import { computeTotals, money, type State } from './state';

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

const SIZE = 1080;
const PAD = 56;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight: number, family: string) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && s > 24) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

function drawBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.fillStyle = C.ball;
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = r * 0.1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  const k = r / 46;
  ctx.moveTo(cx - 32 * k, cy - 32 * k);
  ctx.bezierCurveTo(cx - 14 * k, cy - 16 * k, cx - 14 * k, cy + 16 * k, cx - 32 * k, cy + 32 * k);
  ctx.moveTo(cx + 32 * k, cy - 32 * k);
  ctx.bezierCurveTo(cx + 14 * k, cy - 16 * k, cx + 14 * k, cy + 16 * k, cx + 32 * k, cy + 32 * k);
  ctx.stroke();
  ctx.restore();
}

function drawThermo(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pct: number) {
  const tubeW = 56;
  const bulbR = 62;
  const cx = x + w / 2 + 18;
  const tubeTop = y;
  const tubeBottom = y + h - bulbR * 1.6;
  const tubeH = tubeBottom - tubeTop;
  const full = pct >= 1;

  // Tubo
  roundRect(ctx, cx - tubeW / 2, tubeTop, tubeW, tubeH + bulbR, [tubeW / 2, tubeW / 2, 0, 0]);
  ctx.fillStyle = C.track;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = C.ink;
  ctx.stroke();

  // Relleno
  const fillH = tubeH * Math.min(1, pct);
  if (fillH > 0) {
    ctx.save();
    roundRect(ctx, cx - tubeW / 2 + 3, tubeTop + 3, tubeW - 6, tubeH + bulbR, [tubeW / 2, tubeW / 2, 0, 0]);
    ctx.clip();
    ctx.fillStyle = full ? C.paid : C.ball;
    ctx.fillRect(cx - tubeW / 2, tubeBottom - fillH, tubeW, fillH + bulbR);
    ctx.restore();
  }

  // Marcas
  ctx.font = `700 24px ${BODY}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const p of [25, 50, 75, 100]) {
    const ty = tubeBottom - (tubeH * p) / 100;
    ctx.fillStyle = C.chalkDim;
    ctx.fillText(String(p), cx - tubeW / 2 - 22, ty);
    ctx.fillRect(cx - tubeW / 2 - 16, ty - 1.5, 10, 3);
  }

  drawBall(ctx, cx, y + h - bulbR, bulbR);
}

function drawPhoto(ctx: CanvasRenderingContext2D, img: HTMLImageElement, state: State, x: number, y: number, w: number, h: number) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 20);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h);

  for (const f of state.faces) {
    const fx = x + f.x * w;
    const fy = y + f.y * h;
    const fw = f.w * w;
    const fh = f.h * h;
    const cx = fx + fw / 2;
    if (f.paid) {
      const r = (fw / 2) * 1.08;
      const cy = fy + fh / 2;
      ctx.lineWidth = Math.max(4, fw * 0.045);
      ctx.strokeStyle = C.paid;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      const br = Math.max(12, fw * 0.17);
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
    } else {
      const size = fw * 1.18;
      ctx.font = `${size}px ${EMOJI}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = size * 0.08;
      ctx.shadowOffsetY = size * 0.03;
      ctx.fillText(f.emoji, cx, fy + fh * 0.46 + size * 0.04);
      ctx.shadowColor = 'transparent';
    }
  }
  ctx.restore();

  ctx.lineWidth = 8;
  ctx.strokeStyle = C.chalk;
  roundRect(ctx, x, y, w, h, 20);
  ctx.stroke();
}

export async function renderCard(state: State): Promise<HTMLCanvasElement> {
  await document.fonts.ready;
  await Promise.all([
    document.fonts.load(`900 64px ${DISPLAY}`),
    document.fonts.load(`800 64px ${DISPLAY}`),
    document.fonts.load(`600 24px ${BODY}`),
    document.fonts.load(`700 24px ${BODY}`),
  ]).catch(() => {});

  const t = computeTotals(state);
  const withPhoto = state.includePhoto && !!state.image;
  const img = withPhoto ? await loadImage(state.image!) : null;

  // Formato cuadrado 1:1 (ideal para WhatsApp e Instagram).
  const S = SIZE;
  const contentW = S - PAD * 2;
  const thermoW = 170;
  const gap = 32;

  // Zonas verticales fijas
  const headerTop = PAD;
  const bodyTop = 218;
  const statsH = 136;
  const statsTop = S - PAD + 16 - statsH;
  const footerBaseline = statsTop - 34;
  const bodyBottom = footerBaseline - 64;
  const bodyH = bodyBottom - bodyTop;

  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  // Fondo de cancha
  const bg = ctx.createRadialGradient(S / 2, 0, 0, S / 2, 0, S);
  bg.addColorStop(0.4, C.court);
  bg.addColorStop(1, C.courtShade);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 4;
  for (const [cy, r, a0, a1] of [
    [S, 220, Math.PI, 0],
    [S, 80, Math.PI, 0],
    [0, 220, 0, Math.PI],
  ] as const) {
    ctx.beginPath();
    ctx.arc(S / 2, cy, r, a0, a1);
    ctx.stroke();
  }

  // Cabecera
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.chalkDim;
  ctx.font = `700 24px ${BODY}`;
  ctx.fillText('EL BUEN PAGADOR', PAD, headerTop + 24);

  const title = (state.title.trim() || 'La cancha').toUpperCase();
  const size = fitText(ctx, title, contentW, 96, 900, DISPLAY);
  ctx.fillStyle = C.chalk;
  ctx.fillText(title, PAD, headerTop + 36 + size * 0.86);

  // Cuerpo: foto (o porcentaje) + termómetro
  const thermoX = S - PAD - thermoW;
  const leftW = contentW - thermoW - gap;
  if (img) {
    const ar = img.naturalWidth / img.naturalHeight;
    let pw = leftW;
    let ph = pw / ar;
    if (ph > bodyH) {
      ph = bodyH;
      pw = ph * ar;
    }
    drawPhoto(ctx, img, state, PAD + (leftW - pw) / 2, bodyTop + (bodyH - ph) / 2, pw, ph);
  } else {
    const pctText = `${Math.round(t.pct * 100)}%`;
    ctx.textAlign = 'left';
    ctx.fillStyle = t.pct >= 1 ? C.paid : C.chalk;
    const s = fitText(ctx, pctText, leftW, 280, 900, DISPLAY);
    const baseline = bodyTop + bodyH / 2 + s * 0.3;
    ctx.fillText(pctText, PAD, baseline);
    ctx.font = `600 40px ${BODY}`;
    ctx.fillStyle = C.chalkDim;
    ctx.fillText(`${money(t.collected, state.currency)} de ${money(state.cost, state.currency)}`, PAD + 6, baseline + 64);
  }
  drawThermo(ctx, thermoX, bodyTop, thermoW, bodyH, t.pct);

  // Línea de estado
  const pending = t.people - t.paid;
  let line: string;
  if (t.people === 0) line = 'Sin jugadores todavía';
  else if (pending === 0) line = '¡Cancha pagada! Gracias, buenos pagadores';
  else line = `${Math.round(t.pct * 100)}% pagado · ${pending === 1 ? 'falta 1 persona' : `faltan ${pending} personas`}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = pending === 0 && t.people > 0 ? C.paid : C.chalk;
  fitText(ctx, line.toUpperCase(), contentW, 52, 800, DISPLAY);
  ctx.fillText(line.toUpperCase(), S / 2, footerBaseline);

  // Marcador
  const cells: [string, string][] = [
    ['CANCHA', money(state.cost, state.currency)],
    ['CUOTA', money(t.share, state.currency)],
    ['PAGARON', `${t.paid}/${t.people}`],
    ['FALTA', money(t.missing, state.currency)],
  ];
  roundRect(ctx, PAD, statsTop, contentW, statsH, 22);
  ctx.fillStyle = C.ink;
  ctx.fill();
  const cellW = contentW / cells.length;
  cells.forEach(([label, value], i) => {
    const cx = PAD + cellW * i + cellW / 2;
    if (i > 0) {
      ctx.fillStyle = 'rgba(247,248,252,0.12)';
      ctx.fillRect(PAD + cellW * i, statsTop + 24, 2, statsH - 48);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = C.chalkDim;
    ctx.font = `700 22px ${BODY}`;
    ctx.fillText(label, cx, statsTop + 48);
    ctx.fillStyle = i === 1 ? C.ball : C.chalk;
    fitText(ctx, value, cellW - 24, 60, 800, DISPLAY);
    ctx.fillText(value, cx, statsTop + 108);
  });

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/png'),
  );
}
