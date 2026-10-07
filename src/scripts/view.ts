import { computeTotals, money, type Face, type Totals } from './state';

type TotalsInput = { faces: Face[]; cost: number | null; currency: string; rounding: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function totalsEls() {
  return {
    progress: $<HTMLElement>('progress'),
    label: $<HTMLParagraphElement>('progressLabel'),
    hero: $<HTMLParagraphElement>('heroOut'),
    paidOut: $<HTMLSpanElement>('paidOut'),
    thermo: $<HTMLDivElement>('thermo'),
    shareOut: $<HTMLElement>('shareOut'),
    collectedOut: $<HTMLElement>('collectedOut'),
    missingOut: $<HTMLParagraphElement>('missingOut'),
  };
}

export type TotalsEls = ReturnType<typeof totalsEls>;

export function gameMetaText(game: Pick<TotalsInput, 'faces' | 'cost' | 'currency'>): string {
  const people = game.faces.length;
  const parts = [
    game.cost ? `Cancha\u00a0${money(game.cost, game.currency)}` : '',
    people ? `${people}\u00a0${people === 1 ? 'jugador' : 'jugadores'}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Ponle nombre y costo.';
}

const MAX_SEGMENTS = 40;

export function progressView(t: Totals, data: Pick<TotalsInput, 'cost' | 'currency'>, owner: boolean) {
  const pending = t.people - t.paid;
  if (t.people === 0) return { label: 'Pagaron', hero: '—', full: false };
  if (pending === 0) return { label: '¡Cancha pagada!', hero: data.cost ? money(data.cost, data.currency) : `${t.people}/${t.people}`, full: true };
  if (t.missing != null) return { label: owner ? 'Te faltan' : 'Faltan', hero: money(t.missing, data.currency), full: false };
  return { label: 'Faltan pagar', hero: `${pending} de ${t.people}`, full: false };
}

export function renderTotals(els: TotalsEls, data: TotalsInput, message?: string): Totals {
  const t = computeTotals(data);
  const view = progressView(t, data, els.progress.dataset.perspective !== 'public');
  const pct = Math.round(t.pct * 100);

  els.label.textContent = view.label;
  els.hero.textContent = view.hero;
  els.progress.classList.toggle('is-full', view.full);
  els.paidOut.textContent = `${t.paid}/${t.people}`;
  els.thermo.style.setProperty('--pct', String(t.pct));
  els.thermo.style.setProperty('--n', String(Math.max(1, t.people)));
  els.thermo.classList.toggle('is-dense', t.people > MAX_SEGMENTS);
  els.thermo.setAttribute('aria-valuenow', String(pct));
  els.thermo.setAttribute('aria-valuetext', `${t.paid} de ${t.people} pagaron (${pct} %)`);
  els.shareOut.textContent = money(t.share, data.currency);
  els.collectedOut.textContent = money(t.collected, data.currency);
  els.missingOut.textContent = message ?? '';
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

export function fitStageToPhoto(photo: HTMLImageElement, area: HTMLElement) {
  photo.addEventListener('load', () => {
    const ar = photo.naturalWidth / photo.naturalHeight;
    if (ar > 0) area.style.setProperty('--ar', ar.toFixed(4));
  });
}
