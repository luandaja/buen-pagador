// Render compartido entre el editor y la vista de solo lectura.
import { computeTotals, money, type Face, type Totals } from './state';

type TotalsInput = { faces: Face[]; cost: number | null; currency: string; rounding: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function totalsEls() {
  return {
    peopleOut: $<HTMLSpanElement>('peopleOut'),
    shareOut: $<HTMLSpanElement>('shareOut'),
    paidOut: $<HTMLSpanElement>('paidOut'),
    thermo: $<HTMLDivElement>('thermo'),
    thermoFill: $<HTMLDivElement>('thermoFill'),
    pctOut: $<HTMLParagraphElement>('pctOut'),
    collectedOut: $<HTMLSpanElement>('collectedOut'),
    missingOut: $<HTMLParagraphElement>('missingOut'),
  };
}

export type TotalsEls = ReturnType<typeof totalsEls>;

const pendingText = (pending: number) => (pending === 1 ? 'Falta 1 persona' : `Faltan ${pending} personas`);

/** Texto bajo el porcentaje: cuántos faltan y cuánto falta recaudar. */
export function progressText(t: Totals, data: Pick<TotalsInput, 'cost' | 'currency'>): string {
  const pending = t.people - t.paid;
  if (t.people === 0) return 'Todavía no hay jugadores.';
  if (pending === 0) return '¡Cancha pagada! 🏀';
  if (!data.cost) return `${pendingText(pending)}.`;
  return `${pendingText(pending)} · ${money(t.missing, data.currency)}`;
}

/** Pinta marcador y termómetro. `message` reemplaza el texto de estado. */
export function renderTotals(els: TotalsEls, data: TotalsInput, message?: string): Totals {
  const t = computeTotals(data);
  const pct = Math.round(t.pct * 100);
  const isFull = t.people > 0 && t.paid === t.people;

  els.peopleOut.textContent = String(t.people);
  els.shareOut.textContent = money(t.share, data.currency);
  els.paidOut.textContent = `${t.paid}/${t.people}`;
  els.thermoFill.style.height = `${t.pct * 100}%`;
  els.thermo.setAttribute('aria-valuenow', String(pct));
  els.thermo.classList.toggle('is-full', isFull);
  els.pctOut.textContent = `${pct}%`;
  els.collectedOut.textContent = money(t.collected, data.currency);
  els.missingOut.classList.toggle('done', isFull && !message);
  els.missingOut.textContent = message ?? progressText(t, data);
  return t;
}

const FACE_HTML =
  '<span class="face-ring"></span><span class="face-emoji"></span><span class="face-check">✓</span><span class="face-remove">×</span>';

type FaceOptions = { interactive: boolean; label: (face: Face, index: number) => string };

function createFaceEl(face: Face, interactive: boolean): HTMLElement {
  const el = document.createElement(interactive ? 'button' : 'span');
  if (interactive) el.setAttribute('type', 'button');
  else el.setAttribute('role', 'img');
  el.className = 'face';
  el.dataset.id = face.id;
  el.innerHTML = FACE_HTML;
  // Si ya venía pagado (al cargar) no repetimos la animación.
  if (face.paid) el.classList.add('is-settled');
  return el;
}

function updateFaceEl(el: HTMLElement, face: Face, index: number, opts: FaceOptions) {
  el.style.left = `${face.x * 100}%`;
  el.style.top = `${face.y * 100}%`;
  el.style.width = `${face.w * 100}%`;
  el.style.height = `${face.h * 100}%`;
  el.querySelector('.face-emoji')!.textContent = face.emoji;
  if (!face.paid) el.classList.remove('is-settled');
  el.classList.toggle('is-paid', face.paid);
  if (opts.interactive) el.setAttribute('aria-pressed', String(face.paid));
  el.setAttribute('aria-label', opts.label(face, index));
}

/**
 * Sincroniza los marcadores de caras con el DOM sin recrearlos, para que la
 * animación de "pagó" solo corra cuando cambia el estado.
 */
export function syncFaces(container: HTMLElement, map: Map<string, HTMLElement>, faces: Face[], opts: FaceOptions) {
  const ids = new Set(faces.map((f) => f.id));
  for (const [id, el] of map) {
    if (ids.has(id)) continue;
    el.remove();
    map.delete(id);
  }
  faces.forEach((face, i) => {
    if (!map.has(face.id)) {
      const el = createFaceEl(face, opts.interactive);
      container.append(el);
      map.set(face.id, el);
    }
    updateFaceEl(map.get(face.id)!, face, i, opts);
  });
}

/** La proporción de la foto define el tamaño del escenario (ver .stage-area). */
export function fitStageToPhoto(photo: HTMLImageElement, area: HTMLElement) {
  photo.addEventListener('load', () => {
    const ar = photo.naturalWidth / photo.naturalHeight;
    if (ar > 0) area.style.setProperty('--ar', ar.toFixed(4));
  });
}
