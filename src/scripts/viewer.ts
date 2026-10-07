import { es, locale } from '../i18n/es';
import { renderCard } from './export';
import { canvasToBlob } from './image';
import { loadShare, parsePublicHash, ShareError, type Loaded, type PayInfo, type SharedState } from './share';
import { byId, fitStageToPhoto, progressElements, renderTotals, syncFaces } from './view';

const elements = {
  state: byId<HTMLDivElement>('viewerState'),
  stateTitle: byId<HTMLElement>('viewerStateTitle'),
  stateText: byId<HTMLSpanElement>('viewerStateText'),
  stageWrap: byId<HTMLDivElement>('stageWrap'),
  stageArea: byId<HTMLDivElement>('stageArea'),
  photo: byId<HTMLImageElement>('photo'),
  faces: byId<HTMLDivElement>('faces'),
  panel: byId<HTMLElement>('panel'),
  title: byId<HTMLHeadingElement>('viewTitle'),
  updated: byId<HTMLParagraphElement>('updated'),
  download: byId<HTMLButtonElement>('download'),
  payBox: byId<HTMLElement>('payBox'),
  payNote: byId<HTMLParagraphElement>('payNoteOut'),
  copyPayNote: byId<HTMLButtonElement>('copyPayNote'),
  payQrBox: byId<HTMLElement>('payQrBox'),
  payQr: byId<HTMLImageElement>('payQrOut'),
  payQrSave: byId<HTMLAnchorElement>('payQrSave'),
  exportMsg: byId<HTMLParagraphElement>('exportMsg'),
};
const progressOutputs = progressElements();
const faceMarkers = new Map<string, HTMLElement>();

const POLL_INTERVAL_MS = 30_000;
const COPIED_FEEDBACK_MS = 1500;
const OBJECT_URL_LIFETIME_MS = 5000;

let link: { id: string; key: string } | null = null;
let shared: SharedState | null = null;
let image: string | null = null;
let pay: PayInfo | null = null;
let payVersion = -1;
let pollTimer = 0;

function showMessage(title: string, text: string) {
  elements.state.hidden = false;
  elements.stageWrap.hidden = true;
  elements.panel.hidden = true;
  elements.stateTitle.textContent = title;
  elements.stateText.textContent = text;
}

function renderPay() {
  elements.payBox.hidden = !pay;
  if (!pay) return;
  elements.payNote.textContent = pay.note;
  elements.payNote.hidden = !pay.note;
  elements.copyPayNote.hidden = !pay.note;
  elements.payQrBox.hidden = !pay.qr;
  if (pay.qr) {
    elements.payQr.src = pay.qr;
    elements.payQrSave.href = pay.qr;
  }
}

function render() {
  if (!shared || !image) return;
  elements.state.hidden = true;
  elements.stageWrap.hidden = false;
  elements.panel.hidden = false;
  if (elements.photo.getAttribute('src') !== image) elements.photo.src = image;

  const title = shared.title.trim() || es.viewer.defaultTitle;
  elements.title.textContent = title;
  document.title = es.meta.pageTitle(title);

  syncFaces(elements.faces, faceMarkers, shared.faces, {
    interactive: false,
    label: (face, index) => es.faces.readOnly(index + 1, face.paid),
  });
  renderTotals(progressOutputs, shared);
  renderPay();

  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date());
  elements.updated.textContent = es.viewer.checkedAt(time);
}

export function errorView(error: unknown, hasData: boolean): { title: string; text: string; stop: boolean } | null {
  const status = error instanceof ShareError ? error.status : 0;
  if (status === 404) return { title: es.viewer.goneTitle, text: es.viewer.goneText, stop: true };
  if (status === 400) return { title: es.viewer.brokenTitle, text: es.viewer.brokenText, stop: true };
  if (hasData) return null;
  return { title: es.viewer.offlineTitle, text: es.viewer.offlineText, stop: false };
}

async function withPayIfChanged(target: { id: string; key: string }, loaded: Loaded, included: boolean): Promise<Loaded> {
  if (loaded.pv === payVersion) return loaded;
  const withPay = included ? loaded : await loadShare(target, false, true);
  pay = withPay.pay ?? null;
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
  } catch (error) {
    console.error(error);
    const view = errorView(error, !!shared);
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
  }, POLL_INTERVAL_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && pollTimer) refresh();
});

fitStageToPhoto(elements.photo, elements.stageArea);

elements.copyPayNote.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(pay?.note ?? '');
    elements.copyPayNote.textContent = es.share.copied;
    setTimeout(() => (elements.copyPayNote.textContent = es.pay.copy), COPIED_FEEDBACK_MS);
  } catch {
    getSelection()?.selectAllChildren(elements.payNote);
  }
});

elements.download.addEventListener('click', async () => {
  if (!shared || !image) return;
  elements.download.disabled = true;
  elements.exportMsg.textContent = es.image.generating;
  try {
    const canvas = await renderCard({ ...shared, image, includePhoto: true, payNote: pay?.note, payQr: pay?.qr });
    const blob = await canvasToBlob(canvas);
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = objectUrl;
    downloadLink.download = es.viewer.imageName;
    downloadLink.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_LIFETIME_MS);
    elements.exportMsg.textContent = '';
  } catch (error) {
    console.error(error);
    elements.exportMsg.textContent = es.image.failed;
  } finally {
    elements.download.disabled = false;
  }
});

async function start() {
  link = parsePublicHash(location.hash);
  if (!link) {
    showMessage(es.viewer.brokenTitle, es.viewer.brokenText);
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
