import { es } from '../i18n/es';
import { computeTotals, money, type Face, type Totals } from './state';

type TotalsInput = { faces: Face[]; cost: number | null; currency: string; rounding: number };

export const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function progressElements() {
  return {
    progress: byId<HTMLElement>('progress'),
    label: byId<HTMLParagraphElement>('progressLabel'),
    hero: byId<HTMLParagraphElement>('heroOut'),
    paidOut: byId<HTMLSpanElement>('paidOut'),
    meter: byId<HTMLDivElement>('thermo'),
    shareOut: byId<HTMLElement>('shareOut'),
    collectedOut: byId<HTMLElement>('collectedOut'),
    missingOut: byId<HTMLParagraphElement>('missingOut'),
  };
}

export type ProgressElements = ReturnType<typeof progressElements>;

export function gameMetaText(game: Pick<TotalsInput, 'faces' | 'cost' | 'currency'>): string {
  const people = game.faces.length;
  const parts = [
    game.cost ? es.game.metaCost(money(game.cost, game.currency)) : '',
    people ? es.game.metaPlayers(people) : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : es.game.metaEmpty;
}

const MAX_SEGMENTS = 40;

export function progressView(totals: Totals, game: Pick<TotalsInput, 'cost' | 'currency'>, isOwner: boolean) {
  const pending = totals.people - totals.paid;
  const copy = es.progress;
  if (totals.people === 0) return { label: copy.noPlayers, hero: '—', full: false };
  if (pending === 0) {
    const hero = game.cost ? money(game.cost, game.currency) : `${totals.people}/${totals.people}`;
    return { label: copy.settled, hero, full: true };
  }
  if (totals.missing != null) {
    return { label: isOwner ? copy.ownerMissing : copy.publicMissing, hero: money(totals.missing, game.currency), full: false };
  }
  return { label: copy.pendingLabel, hero: copy.pendingHero(pending, totals.people), full: false };
}

function renderMeter(meter: HTMLElement, totals: Totals) {
  const percent = Math.round(totals.paidRatio * 100);
  meter.style.setProperty('--pct', String(totals.paidRatio));
  meter.style.setProperty('--n', String(Math.max(1, totals.people)));
  meter.classList.toggle('is-dense', totals.people > MAX_SEGMENTS);
  meter.setAttribute('aria-valuenow', String(percent));
  meter.setAttribute('aria-valuetext', es.progress.valueText(totals.paid, totals.people, percent));
}

export function renderTotals(elements: ProgressElements, game: TotalsInput, message?: string): Totals {
  const totals = computeTotals(game);
  const view = progressView(totals, game, elements.progress.dataset.perspective !== 'public');
  elements.label.textContent = view.label;
  elements.hero.textContent = view.hero;
  elements.progress.classList.toggle('is-full', view.full);
  elements.paidOut.textContent = `${totals.paid}/${totals.people}`;
  renderMeter(elements.meter, totals);
  elements.shareOut.textContent = money(totals.share, game.currency);
  elements.collectedOut.textContent = money(totals.collected, game.currency);
  elements.missingOut.textContent = message ?? '';
  return totals;
}

const FACE_HTML =
  '<span class="face-ring"></span><span class="face-emoji"></span><span class="face-check">✓</span><span class="face-remove">×</span>';

type FaceOptions = { interactive: boolean; label: (face: Face, index: number) => string };

function createFaceMarker(face: Face, interactive: boolean): HTMLElement {
  const marker = document.createElement(interactive ? 'button' : 'span');
  if (interactive) marker.setAttribute('type', 'button');
  else marker.setAttribute('role', 'img');
  marker.className = 'face';
  marker.dataset.id = face.id;
  marker.innerHTML = FACE_HTML;
  if (face.paid) marker.classList.add('is-settled');
  return marker;
}

function updateFaceMarker(marker: HTMLElement, face: Face, index: number, options: FaceOptions) {
  marker.style.left = `${face.x * 100}%`;
  marker.style.top = `${face.y * 100}%`;
  marker.style.width = `${face.w * 100}%`;
  marker.style.height = `${face.h * 100}%`;
  marker.querySelector('.face-emoji')!.textContent = face.emoji;
  if (!face.paid) marker.classList.remove('is-settled');
  marker.classList.toggle('is-paid', face.paid);
  if (options.interactive) marker.setAttribute('aria-pressed', String(face.paid));
  marker.setAttribute('aria-label', options.label(face, index));
}

export function syncFaces(container: HTMLElement, markers: Map<string, HTMLElement>, faces: Face[], options: FaceOptions) {
  const currentIds = new Set(faces.map((face) => face.id));
  for (const [faceId, marker] of markers) {
    if (currentIds.has(faceId)) continue;
    marker.remove();
    markers.delete(faceId);
  }
  faces.forEach((face, index) => {
    if (!markers.has(face.id)) {
      const marker = createFaceMarker(face, options.interactive);
      container.append(marker);
      markers.set(face.id, marker);
    }
    updateFaceMarker(markers.get(face.id)!, face, index, options);
  });
}

export function fitStageToPhoto(photo: HTMLImageElement, stageArea: HTMLElement) {
  photo.addEventListener('load', () => {
    const aspectRatio = photo.naturalWidth / photo.naturalHeight;
    if (aspectRatio > 0) stageArea.style.setProperty('--ar', aspectRatio.toFixed(4));
  });
}
