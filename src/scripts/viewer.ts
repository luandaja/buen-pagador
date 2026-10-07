// Vista pública de solo lectura: /ver#<id>.<clave>
import { renderCard } from './export';
import { canvasToBlob } from './image';
import { loadShare, parsePublicHash, ShareError, type Loaded, type PayInfo, type SharedState } from './share';
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
  payBox: $<HTMLElement>('payBox'),
  payNote: $<HTMLParagraphElement>('payNoteOut'),
  copyPayNote: $<HTMLButtonElement>('copyPayNote'),
  payQrBox: $<HTMLElement>('payQrBox'),
  payQr: $<HTMLImageElement>('payQrOut'),
  payQrSave: $<HTMLAnchorElement>('payQrSave'),
  exportMsg: $<HTMLParagraphElement>('exportMsg'),
};
const totals = totalsEls();
const faceEls = new Map<string, HTMLElement>();

const POLL_MS = 30_000;

let link: { id: string; key: string } | null = null;
let shared: SharedState | null = null;
let image: string | null = null;
let pay: PayInfo | null = null;
/** Versión de los datos para pagar que ya tenemos (-1: todavía ninguna). */
let payVersion = -1;
let pollTimer = 0;

function showMessage(title: string, text: string) {
  els.state.hidden = false;
  els.stageWrap.hidden = true;
  els.panel.hidden = true;
  els.stateTitle.textContent = title;
  els.stateText.textContent = text;
}

function renderPay() {
  els.payBox.hidden = !pay;
  if (!pay) return;
  els.payNote.textContent = pay.note;
  els.payNote.hidden = !pay.note;
  els.copyPayNote.hidden = !pay.note;
  els.payQrBox.hidden = !pay.qr;
  if (pay.qr) {
    els.payQr.src = pay.qr;
    els.payQrSave.href = pay.qr;
  }
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
  renderPay();

  const time = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  els.updated.textContent = `Revisado a las ${time}`;
}

/** Qué mostrar si falla la carga. `stop`: el link no se va a arreglar solo. */
export function errorView(err: unknown, hasData: boolean): { title: string; text: string; stop: boolean } | null {
  const status = err instanceof ShareError ? err.status : 0;
  if (status === 404)
    return {
      title: 'Este link ya no existe',
      text: 'Puede que haya expirado o que quien lo creó haya dejado de compartirlo.',
      stop: true,
    };
  if (status === 400) return { title: 'Link incompleto', text: 'Pide que te lo vuelvan a mandar, copiándolo completo.', stop: true };
  if (hasData) return null; // Fallo pasajero: seguimos mostrando lo último.
  return { title: 'Sin conexión', text: 'No pudimos abrir el link. Revisa tu internet y recarga la página.', stop: false };
}

/** Si cambiaron los datos para pagar, los pide aparte (salvo que ya vinieran). */
async function withPayIfChanged(target: { id: string; key: string }, loaded: Loaded, included: boolean): Promise<Loaded> {
  if (loaded.pv === payVersion) return loaded;
  const fresh = included ? loaded : await loadShare(target, false, true);
  pay = fresh.pay ?? null;
  payVersion = loaded.pv;
  return loaded;
}

async function refresh(withImage = false) {
  if (!link) return;
  try {
    const loaded = await withPayIfChanged(link, await loadShare(link, withImage), withImage);
    image = loaded.image ?? image;
    shared = loaded.state;
    render();
  } catch (err) {
    console.error(err);
    const view = errorView(err, !!shared);
    if (view?.stop) stopPolling();
    if (view) showMessage(view.title, view.text);
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

els.copyPayNote.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(pay?.note ?? '');
    els.copyPayNote.textContent = 'Copiado ✓';
    setTimeout(() => (els.copyPayNote.textContent = 'Copiar datos'), 1500);
  } catch {
    getSelection()?.selectAllChildren(els.payNote);
  }
});

els.download.addEventListener('click', async () => {
  if (!shared || !image) return;
  els.download.disabled = true;
  els.exportMsg.textContent = 'Generando imagen…';
  try {
    const canvas = await renderCard({ ...shared, image, includePhoto: true, payNote: pay?.note, payQr: pay?.qr });
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
  pay = null;
  payVersion = -1;
  start();
});

start();
