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

/** Pinta marcador y termómetro. `message` reemplaza el texto de estado. */
export function renderTotals(els: TotalsEls, data: TotalsInput, message?: string): Totals {
  const t = computeTotals(data);
  els.peopleOut.textContent = String(t.people);
  els.shareOut.textContent = money(t.share, data.currency);
  els.paidOut.textContent = `${t.paid}/${t.people}`;

  const pct = Math.round(t.pct * 100);
  els.thermoFill.style.height = `${t.pct * 100}%`;
  els.thermo.setAttribute('aria-valuenow', String(pct));
  const isFull = t.people > 0 && t.paid === t.people;
  if (isFull !== els.thermo.classList.contains('is-full')) els.thermo.classList.toggle('is-full', isFull);

  els.pctOut.textContent = `${pct}%`;
  els.collectedOut.textContent = money(t.collected, data.currency);

  const pending = t.people - t.paid;
  els.missingOut.classList.toggle('done', isFull && !message);
  if (message) els.missingOut.textContent = message;
  else if (t.people === 0) els.missingOut.textContent = 'Todavía no hay jugadores.';
  else if (isFull) els.missingOut.textContent = '¡Cancha pagada! 🏀';
  else if (!data.cost) els.missingOut.textContent = `${pending === 1 ? 'Falta 1 persona' : `Faltan ${pending} personas`}.`;
  else
    els.missingOut.textContent = `${pending === 1 ? 'Falta 1 persona' : `Faltan ${pending} personas`} · ${money(t.missing, data.currency)}`;
  return t;
}

const FACE_HTML =
  '<span class="face-ring"></span><span class="face-emoji"></span><span class="face-check">✓</span><span class="face-remove">×</span>';

/**
 * Sincroniza los marcadores de caras con el DOM sin recrearlos, para que la
 * animación de "pagó" solo corra cuando cambia el estado.
 */
export function syncFaces(
  container: HTMLElement,
  map: Map<string, HTMLElement>,
  faces: Face[],
  opts: { interactive: boolean; label: (face: Face, index: number) => string },
) {
  const seen = new Set<string>();
  faces.forEach((face, i) => {
    seen.add(face.id);
    let el = map.get(face.id);
    if (!el) {
      el = document.createElement(opts.interactive ? 'button' : 'span');
      if (el instanceof HTMLButtonElement) el.type = 'button';
      else el.setAttribute('role', 'img');
      el.className = 'face';
      el.dataset.id = face.id;
      el.innerHTML = FACE_HTML;
      // Si ya venía pagado (al cargar) no repetimos la animación.
      if (face.paid) el.classList.add('is-settled');
      container.append(el);
      map.set(face.id, el);
    }
    el.style.left = `${face.x * 100}%`;
    el.style.top = `${face.y * 100}%`;
    el.style.width = `${face.w * 100}%`;
    el.style.height = `${face.h * 100}%`;
    el.querySelector('.face-emoji')!.textContent = face.emoji;
    if (!face.paid) el.classList.remove('is-settled');
    el.classList.toggle('is-paid', face.paid);
    if (opts.interactive) el.setAttribute('aria-pressed', String(face.paid));
    el.setAttribute('aria-label', opts.label(face, i));
  });
  for (const [id, el] of map) {
    if (!seen.has(id)) {
      el.remove();
      map.delete(id);
    }
  }
}

/** La proporción de la foto define el tamaño del escenario (ver .stage-area). */
export function fitStageToPhoto(photo: HTMLImageElement, area: HTMLElement) {
  photo.addEventListener('load', () => {
    const ar = photo.naturalWidth / photo.naturalHeight;
    if (ar > 0) area.style.setProperty('--ar', ar.toFixed(4));
  });
}
