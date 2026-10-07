// Vista pública de solo lectura: /ver#<id>.<clave>
import { canvasToBlob, renderCard } from './export';
import { loadShare, parsePublicHash, ShareError, type SharedState } from './share';
import { fitStageToPhoto, renderTotals, syncFaces, totalsEls } from './view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  state: $<HTMLDivElement>('viewerState'),
  stateTitle: $<HTMLElement>('viewerStateTitle'),
  stateText: $<HTMLSpanElement>('viewerStateText'),
  stageWrap: $<HTMLDivElement>('stageWrap'),
  stageArea: $<HTMLDivElement>('stageArea'),
  photo: $<HTMLImageElement>('photo'),
  faces: $<HTMLDivElement>('faces'),
  panel: $<HTMLElement>('panel'),
  title: $<HTMLHeadingElement>('viewTitle'),
  updated: $<HTMLParagraphElement>('updated'),
  download: $<HTMLButtonElement>('download'),
  exportMsg: $<HTMLParagraphElement>('exportMsg'),
};
const totals = totalsEls();
const faceEls = new Map<string, HTMLElement>();

const POLL_MS = 30_000;

let link: { id: string; key: string } | null = null;
let shared: SharedState | null = null;
let image: string | null = null;
let version = 0;
let pollTimer = 0;

function showMessage(title: string, text: string) {
  els.state.hidden = false;
  els.stageWrap.hidden = true;
  els.panel.hidden = true;
  els.stateTitle.textContent = title;
  els.stateText.textContent = text;
}

function render() {
  if (!shared || !image) return;
  els.state.hidden = true;
  els.stageWrap.hidden = false;
  els.panel.hidden = false;
  if (els.photo.getAttribute('src') !== image) els.photo.src = image;

  const title = shared.title.trim() || 'La cancha';
  els.title.textContent = title;
  document.title = `${title} · El Buen Pagador`;

  syncFaces(els.faces, faceEls, shared.faces, {
    interactive: false,
    label: (f, i) => `Persona ${i + 1}: ${f.paid ? 'pagó' : 'debe'}`,
  });
  renderTotals(totals, shared);

  const time = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  els.updated.textContent = `Revisado a las ${time}`;
}

async function refresh(withImage = false) {
  if (!link) return;
  try {
    const loaded = await loadShare(link, withImage);
    if (loaded.image) image = loaded.image;
    if (withImage || loaded.v !== version) {
      shared = loaded.state;
      version = loaded.v;
    }
    render();
  } catch (err) {
    console.error(err);
    if (err instanceof ShareError && err.status === 404) {
      stopPolling();
      showMessage('Este link ya no existe', 'Puede que haya expirado o que quien lo creó haya dejado de compartirlo.');
    } else if (err instanceof ShareError && err.status === 400) {
      stopPolling();
      showMessage('Link incompleto', 'Pide que te lo vuelvan a mandar, copiándolo completo.');
    } else if (!shared) {
      showMessage('Sin conexión', 'No pudimos abrir el link. Revisa tu internet y recarga la página.');
    }
  }
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = 0;
}

function startPolling() {
  stopPolling();
  pollTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, POLL_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && pollTimer) refresh();
});

fitStageToPhoto(els.photo, els.stageArea);

els.download.addEventListener('click', async () => {
  if (!shared || !image) return;
  els.download.disabled = true;
  els.exportMsg.textContent = 'Generando imagen…';
  try {
    const canvas = await renderCard({ ...shared, image, includePhoto: true, blocked: [], share: null });
    const blob = await canvasToBlob(canvas);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'buen-pagador.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    els.exportMsg.textContent = '';
  } catch (err) {
    console.error(err);
    els.exportMsg.textContent = 'No se pudo generar la imagen. Intenta de nuevo.';
  } finally {
    els.download.disabled = false;
  }
});

async function start() {
  link = parsePublicHash(location.hash);
  if (!link) {
    showMessage('Link incompleto', 'Pide que te lo vuelvan a mandar, copiándolo completo.');
    return;
  }
  await refresh(true);
  if (shared) startPolling();
}

window.addEventListener('hashchange', () => {
  shared = null;
  image = null;
  version = 0;
  start();
});

start();
