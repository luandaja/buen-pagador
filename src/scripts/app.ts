import { detectFaces, warmUp } from './detect';
import { renderCard } from './export';
import {
  addFaceAt,
  blockEmoji,
  boxesToFaces,
  faceLabel,
  fileName,
  removeFace,
  rerollEmojis,
  statusMessage,
  togglePaid,
  type Mode,
} from './faces';
import { canvasToBlob, fileToDataUrl } from './image';
import {
  createShare,
  deleteShare,
  loadShare,
  masterUrl,
  parseMasterHash,
  publicUrl,
  pushShare,
  ShareError,
  type ShareLink,
} from './share';
import { loadState, pickEmojis, saveState, type State } from './state';
import { fitStageToPhoto, renderTotals, syncFaces, totalsEls } from './view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  dropzone: $<HTMLLabelElement>('dropzone'),
  file: $<HTMLInputElement>('file'),
  stageWrap: $<HTMLDivElement>('stageWrap'),
  stageArea: $<HTMLDivElement>('stageArea'),
  stage: $<HTMLDivElement>('stage'),
  photo: $<HTMLImageElement>('photo'),
  faces: $<HTMLDivElement>('faces'),
  scanning: $<HTMLDivElement>('scanning'),
  scanText: $<HTMLParagraphElement>('scanText'),
  hint: $<HTMLParagraphElement>('hint'),
  blockedBar: $<HTMLParagraphElement>('blockedBar'),
  blockedList: $<HTMLSpanElement>('blockedList'),
  unblock: $<HTMLButtonElement>('unblock'),
  reroll: $<HTMLButtonElement>('reroll'),
  peek: $<HTMLButtonElement>('peek'),
  newPhoto: $<HTMLButtonElement>('newPhoto'),
  title: $<HTMLInputElement>('title'),
  currency: $<HTMLInputElement>('currency'),
  cost: $<HTMLInputElement>('cost'),
  rounding: $<HTMLSelectElement>('rounding'),
  includePhoto: $<HTMLInputElement>('includePhoto'),
  download: $<HTMLButtonElement>('download'),
  share: $<HTMLButtonElement>('share'),
  exportMsg: $<HTMLParagraphElement>('exportMsg'),
  syncStatus: $<HTMLSpanElement>('syncStatus'),
  linkAction: $<HTMLButtonElement>('linkAction'),
  linkReady: $<HTMLDivElement>('linkReady'),
  publicUrl: $<HTMLInputElement>('publicUrl'),
  masterUrl: $<HTMLInputElement>('masterUrl'),
  stopLink: $<HTMLButtonElement>('stopLink'),
};
const totals = totalsEls();

const touch = matchMedia('(hover: none)').matches;
const HINTS: Record<Mode, string> = {
  pay: `Toca una cara cuando esa persona pague. ${touch ? 'Mantén presionado un emoji' : 'Clic derecho en un emoji'} para cambiarlo y no volver a verlo.`,
  edit: 'Toca un espacio vacío para agregar a alguien que no detectamos. Toca una cara para quitarla.',
};

/** Campos que ven los demás en el link: si cambian, se sincroniza. */
const SHARED_FIELDS: (keyof State)[] = ['faces', 'cost', 'currency', 'title', 'rounding'];

let state: State = loadState();
let mode: Mode = 'pay';
let scanning = false;
let creating = false;
let copiedRecently = false;
const faceEls = new Map<string, HTMLElement>();

// ——— Persistencia ———
let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveState(state), 250);
}

// Guarda de inmediato si la página se cierra o recarga antes del debounce.
window.addEventListener('pagehide', () => {
  clearTimeout(saveTimer);
  saveState(state);
});

const touchesShared = (patch: Partial<State>) => SHARED_FIELDS.some((k) => k in patch);

/** Aplica cambios, guarda y repinta. `sync: false` cuando los datos ya vienen del servidor. */
function update(patch: Partial<State>, sync = true) {
  state = { ...state, ...patch };
  persist();
  render();
  if (sync && state.share && touchesShared(patch)) scheduleSync();
}

// ——— Render ———
function setMode(next: Mode) {
  mode = next;
  els.stage.classList.toggle('is-edit', mode === 'edit');
  els.hint.textContent = HINTS[mode];
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  });
  renderFaces();
}

function renderFaces() {
  syncFaces(els.faces, faceEls, state.faces, { interactive: true, label: (f, i) => faceLabel(f, i, mode) });
}

const LINK_ACTION = { create: '🔗 Crear link para el grupo', copy: '🔗 Copiar link del grupo' };

function renderLink() {
  const link = state.share;
  if (!copiedRecently) els.linkAction.textContent = link ? LINK_ACTION.copy : LINK_ACTION.create;
  els.linkAction.disabled = !state.image || scanning || creating;
  els.linkReady.hidden = !link;
  els.publicUrl.value = link ? publicUrl(link) : '';
  els.masterUrl.value = link ? masterUrl(link) : '';
}

function render() {
  const hasImage = !!state.image;
  els.dropzone.hidden = hasImage;
  els.stageWrap.hidden = !hasImage;
  if (hasImage && els.photo.getAttribute('src') !== state.image) els.photo.src = state.image!;
  els.scanning.hidden = !scanning;
  els.download.disabled = scanning;
  els.share.disabled = scanning;
  els.blockedBar.hidden = state.blocked.length === 0;
  els.blockedList.textContent = state.blocked.join(' ');
  renderFaces();
  renderTotals(totals, state, statusMessage(state, scanning));
  renderLink();
}

function fillForm() {
  els.title.value = state.title;
  els.currency.value = state.currency;
  els.cost.value = state.cost == null ? '' : String(state.cost);
  els.rounding.value = String(state.rounding);
  els.includePhoto.checked = state.includePhoto;
}

// ——— Foto ———
async function detect() {
  const boxes = await detectFaces(els.photo);
  const aspect = els.photo.naturalWidth / els.photo.naturalHeight;
  return boxesToFaces(boxes, aspect, pickEmojis(boxes.length, [], state.blocked));
}

function startScan(image: string) {
  scanning = true;
  setPeek(false);
  // Una foto nueva es otro partido: el link anterior queda con su último estado.
  setSync(state.share ? 'La foto nueva necesita un link nuevo.' : '');
  update({ image, faces: [], share: null });
  setMode('pay');
}

function finishScan(faces: State['faces'], failed = false) {
  scanning = false;
  update({ faces });
  if (faces.length > 0) return;
  setMode('edit');
  els.hint.textContent = failed
    ? 'No pudimos detectar caras automáticamente. Toca cada cara para agregarla a mano.'
    : 'No encontramos caras. Toca cada cara para agregarla a mano.';
}

async function handleFile(file: File | undefined) {
  if (!file?.type.startsWith('image/')) {
    els.exportMsg.textContent = file ? 'Ese archivo no es una imagen.' : '';
    return;
  }
  try {
    startScan(await fileToDataUrl(file));
    await els.photo.decode();
    finishScan(await detect());
  } catch (err) {
    console.error(err);
    finishScan([], true);
  }
}

fitStageToPhoto(els.photo, els.stageArea);

els.file.addEventListener('change', () => {
  handleFile(els.file.files?.[0]);
  els.file.value = '';
});

const setOver = (on: boolean) => (e: Event) => {
  e.preventDefault();
  els.dropzone.classList.toggle('is-over', on);
};
els.dropzone.addEventListener('dragenter', setOver(true));
els.dropzone.addEventListener('dragover', setOver(true));
els.dropzone.addEventListener('dragleave', setOver(false));
els.dropzone.addEventListener('drop', (e) => {
  setOver(false)(e);
  handleFile(e.dataTransfer?.files?.[0]);
});

els.newPhoto.addEventListener('click', () => els.file.click());

// ——— Caras ———
const faceTarget = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('.face');

function onFaceClick(id: string) {
  update({ faces: mode === 'pay' ? togglePaid(state.faces, id) : removeFace(state.faces, id) });
}

function onEmptyClick(e: MouseEvent) {
  const rect = els.faces.getBoundingClientRect();
  const cx = (e.clientX - rect.left) / rect.width;
  const cy = (e.clientY - rect.top) / rect.height;
  update({ faces: addFaceAt(state.faces, cx, cy, rect.width / rect.height, state.blocked) });
}

els.faces.addEventListener('click', (e) => {
  if (scanning) return;
  const target = faceTarget(e);
  if (target) onFaceClick(target.dataset.id!);
  else if (mode === 'edit') onEmptyClick(e);
});

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
  b.addEventListener('click', () => setMode(b.dataset.mode as Mode)),
);

// ——— Bloquear emojis ———
// Clic derecho (o mantener presionado en el celular) sobre un emoji lo bloquea:
// todas las caras con ese emoji reciben otro y no vuelve a salir.
let lastBlock = { id: '', at: 0 };

/** Android dispara contextmenu y también nuestro long-press: evitamos doble bloqueo. */
function isRepeatedBlock(faceId: string) {
  const now = Date.now();
  const repeated = lastBlock.id === faceId && now - lastBlock.at < 1000;
  lastBlock = { id: faceId, at: now };
  return repeated;
}

function blockEmojiOf(faceId: string) {
  if (isRepeatedBlock(faceId)) return;
  const result = blockEmoji(state, faceId);
  if (!result.ok) {
    if (result.reason === 'too-few') els.hint.textContent = 'Quedan muy pocos emojis. Restaura los bloqueados para seguir cambiando.';
    return;
  }
  update({ faces: result.faces, blocked: result.blocked });
  els.hint.textContent = `Listo, ${result.emoji} no vuelve a salir.`;
  const el = faceEls.get(faceId);
  el?.classList.add('is-swapped');
  setTimeout(() => el?.classList.remove('is-swapped'), 400);
}

els.faces.addEventListener('contextmenu', (e) => {
  const target = faceTarget(e);
  if (!target || scanning) return;
  e.preventDefault();
  blockEmojiOf(target.dataset.id!);
});

// Long-press para iOS (Safari no dispara contextmenu en botones).
let pressTimer = 0;
let suppressClick = false;
els.faces.addEventListener('pointerdown', (e) => {
  const target = faceTarget(e);
  if (e.pointerType !== 'touch' || !target) return;
  clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => {
    suppressClick = true;
    blockEmojiOf(target.dataset.id!);
  }, 550);
});
const cancelPress = () => clearTimeout(pressTimer);
for (const type of ['pointerup', 'pointercancel', 'pointerleave']) els.faces.addEventListener(type, cancelPress);
els.faces.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') cancelPress();
});
// Evita que el "click" posterior al long-press marque la cara como pagada.
els.faces.addEventListener(
  'click',
  (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopImmediatePropagation();
  },
  true,
);

els.unblock.addEventListener('click', () => {
  update({ blocked: [] });
  els.hint.textContent = HINTS[mode];
});

// ——— Ver caras ———
// Quita los emojis temporalmente para identificar a cada uno. No se guarda
// ni afecta la imagen exportada.
function setPeek(on: boolean) {
  els.stage.classList.toggle('is-peek', on);
  els.peek.setAttribute('aria-pressed', String(on));
  els.peek.innerHTML = on ? '🙈&nbsp;Tapar caras' : '👀&nbsp;Ver caras';
}

els.peek.addEventListener('click', () => setPeek(!els.stage.classList.contains('is-peek')));

els.reroll.addEventListener('click', () => update({ faces: rerollEmojis(state.faces, state.blocked) }));

// ——— Formulario ———
fillForm();

const parseCost = (value: string) => {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};
els.title.addEventListener('input', () => update({ title: els.title.value }));
els.currency.addEventListener('input', () => update({ currency: els.currency.value.trim() }));
els.cost.addEventListener('input', () => update({ cost: parseCost(els.cost.value) }));
els.rounding.addEventListener('change', () => update({ rounding: parseFloat(els.rounding.value) }));
els.includePhoto.addEventListener('change', () => update({ includePhoto: els.includePhoto.checked }));

// ——— Exportar ———
async function buildFile() {
  const blob = await canvasToBlob(await renderCard(state));
  return new File([blob], fileName(state.title), { type: 'image/png' });
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

els.download.addEventListener('click', async () => {
  els.download.disabled = true;
  els.exportMsg.textContent = 'Generando imagen…';
  try {
    const file = await buildFile();
    downloadFile(file);
    els.exportMsg.textContent = `Imagen descargada: ${file.name}`;
  } catch (err) {
    console.error(err);
    els.exportMsg.textContent = 'No se pudo generar la imagen. Intenta de nuevo.';
  } finally {
    els.download.disabled = false;
  }
});

async function shareImage() {
  els.share.disabled = true;
  try {
    await navigator.share({ files: [await buildFile()], title: 'El Buen Pagador' });
    els.exportMsg.textContent = '';
  } catch (err) {
    const aborted = (err as DOMException).name === 'AbortError';
    if (!aborted) els.exportMsg.textContent = 'No se pudo compartir. Usa “Descargar imagen”.';
  } finally {
    els.share.disabled = false;
  }
}

const probe = new File([new Blob()], 'x.png', { type: 'image/png' });
els.share.hidden = !navigator.canShare?.({ files: [probe] });
els.share.addEventListener('click', shareImage);

// ——— Link compartido ———
let syncTimer = 0;
let syncing: Promise<void> | null = null;
let dirty = false;

function setSync(text: string, tone: 'ok' | 'busy' | 'error' | '' = '') {
  els.syncStatus.textContent = text;
  els.syncStatus.dataset.tone = tone;
}

const LOST_LINK: Record<number, string> = {
  404: 'El link expiró. Crea uno nuevo.',
  403: 'Este equipo ya no puede editar ese link.',
};

/** Si el servidor dice que el link ya no sirve, lo soltamos. */
function dropLinkOn(err: unknown): boolean {
  const message = err instanceof ShareError ? LOST_LINK[err.status] : undefined;
  if (!message) return false;
  update({ share: null });
  setSync(message, 'error');
  return true;
}

function queueSync(delay: number) {
  dirty = true;
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(runSync, delay);
}

function scheduleSync() {
  setSync('Guardando…', 'busy');
  queueSync(800);
}

async function pushOnce(link: ShareLink) {
  try {
    await pushShare(link, state);
    if (!dirty) setSync('Al día ✓', 'ok');
  } catch (err) {
    console.error(err);
    if (dropLinkOn(err)) return;
    setSync('Sin conexión. Reintentando…', 'error');
    queueSync(5000);
  }
}

async function runSync() {
  // Si hay un envío en curso, esperamos a que termine.
  await syncing;
  const link = state.share;
  if (!link || !dirty) return;
  dirty = false;
  syncing = pushOnce(link);
  await syncing;
  syncing = null;
}

async function createLink() {
  creating = true;
  renderLink();
  setSync('Creando link…', 'busy');
  try {
    update({ share: await createShare(state) });
    setSync('Al día ✓', 'ok');
  } catch (err) {
    console.error(err);
    setSync(err instanceof ShareError ? err.message : 'No se pudo crear el link. Intenta de nuevo.', 'error');
  } finally {
    creating = false;
    renderLink();
  }
}

async function copyText(text: string, input?: HTMLInputElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Sin permiso de portapapeles: dejamos el texto seleccionado para copiarlo a mano.
    input?.select();
    return false;
  }
}

/** Muestra "Copiado" en el botón por un momento. */
function flashCopied(btn: HTMLButtonElement, restore: () => void) {
  btn.textContent = 'Copiado ✓';
  setTimeout(restore, 1500);
}

els.linkAction.addEventListener('click', async () => {
  if (!state.share) return createLink();
  if (!(await copyText(els.publicUrl.value, els.publicUrl))) return;
  copiedRecently = true;
  flashCopied(els.linkAction, () => {
    copiedRecently = false;
    renderLink();
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const input = $<HTMLInputElement>(btn.dataset.copy!);
    if (await copyText(input.value, input)) flashCopied(btn, () => (btn.textContent = 'Copiar'));
  }),
);

async function stopSharing(link: ShareLink) {
  try {
    await deleteShare(link);
  } catch (err) {
    if (!dropLinkOn(err)) return setSync('No se pudo borrar el link. Intenta de nuevo.', 'error');
  }
  clearTimeout(syncTimer);
  update({ share: null });
  setSync('Link borrado.');
}

els.stopLink.addEventListener('click', () => {
  if (state.share && confirm('El link dejará de funcionar para todos. ¿Dejar de compartir?')) stopSharing(state.share);
});

/** ¿Hay que importar este link maestro? Pregunta antes de reemplazar otra foto. */
function wantsImport(link: ShareLink) {
  if (state.share?.id === link.id) return false;
  return !state.image || confirm('Este link reemplaza la foto y los pagos que tienes abiertos aquí. ¿Continuar?');
}

async function openMasterLink(link: ShareLink) {
  setSync('Abriendo link maestro…', 'busy');
  try {
    const loaded = await loadShare(link, true);
    if (!loaded.canEdit) return setSync('Ese link maestro no es válido.', 'error');
    setPeek(false);
    update({ ...loaded.state, image: loaded.image ?? null, share: link }, false);
    fillForm();
    setSync('Al día ✓', 'ok');
  } catch (err) {
    console.error(err);
    setSync(err instanceof ShareError ? err.message : 'No se pudo abrir el link.', 'error');
  }
}

/** Abre un link maestro (#editar=…) y carga ese partido para editarlo aquí. */
async function importFromMasterLink() {
  const link = parseMasterHash(location.hash);
  if (!link) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (wantsImport(link)) await openMasterLink(link);
}

window.addEventListener('hashchange', importFromMasterLink);

// ——— Inicio ———
setMode('pay');
render();
if (state.share) setSync('Al día ✓', 'ok');
importFromMasterLink();
warmUp();
