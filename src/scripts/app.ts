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
import { deleteGame, findByShareId, listGames, loadGame, saveGame } from './games';
import { renderHistory } from './history';
import { canvasToBlob, fileToDataUrl, qrFromFile, thumbFrom } from './image';
import {
  createShare,
  deleteShare,
  loadShare,
  masterUrl,
  parseMasterHash,
  publicUrl,
  pushShare,
  ShareError,
  type PayInfo,
  type ShareLink,
} from './share';
import {
  computeTotals,
  loadPrefs,
  newGame,
  pickEmojis,
  refreshEmojis,
  savePrefs,
  splitState,
  takeLegacy,
  type Game,
  type Prefs,
  type State,
} from './state';
import { fitStageToPhoto, gameMetaText, progressView, renderTotals, syncFaces, totalsEls } from './view';

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
  gameTitle: $<HTMLHeadingElement>('gameTitle'),
  gameMeta: $<HTMLParagraphElement>('gameMeta'),
  editGame: $<HTMLButtonElement>('editGame'),
  gameForm: $<HTMLDivElement>('gameForm'),
  doneGame: $<HTMLButtonElement>('doneGame'),
  title: $<HTMLInputElement>('title'),
  payNote: $<HTMLTextAreaElement>('payNote'),
  payQrFile: $<HTMLInputElement>('payQrFile'),
  payQrPreview: $<HTMLImageElement>('payQrPreview'),
  payQrLabel: $<HTMLSpanElement>('payQrLabel'),
  payQrRemove: $<HTMLButtonElement>('payQrRemove'),
  payChip: $<HTMLParagraphElement>('payChip'),
  payChipQr: $<HTMLImageElement>('payChipQr'),
  payChipNote: $<HTMLSpanElement>('payChipNote'),
  currency: $<HTMLInputElement>('currency'),
  cost: $<HTMLInputElement>('cost'),
  rounding: $<HTMLSelectElement>('rounding'),
  steps: $<HTMLOListElement>('steps'),
  progressWrap: $<HTMLDivElement>('progressWrap'),
  dockSum: $<HTMLParagraphElement>('dockSum'),
  includePhoto: $<HTMLInputElement>('includePhoto'),
  download: $<HTMLButtonElement>('download'),
  share: $<HTMLButtonElement>('share'),
  exportMsg: $<HTMLParagraphElement>('exportMsg'),
  syncStatus: $<HTMLSpanElement>('syncStatus'),
  linkShare: $<HTMLElement>('linkShare'),
  panelActions: document.querySelector<HTMLDivElement>('.panel-actions')!,
  linkAction: $<HTMLButtonElement>('linkAction'),
  linkReady: $<HTMLDivElement>('linkReady'),
  publicUrl: $<HTMLSpanElement>('publicUrl'),
  masterBox: $<HTMLDivElement>('masterBox'),
  copyMaster: $<HTMLButtonElement>('copyMaster'),
  stopLink: $<HTMLButtonElement>('stopLink'),
  announce: $<HTMLParagraphElement>('announce'),
  openHistory: $<HTMLButtonElement>('openHistory'),
  historyCount: $<HTMLSpanElement>('historyCount'),
  historyCountLabel: $<HTMLSpanElement>('historyCountLabel'),
  historyStatus: $<HTMLParagraphElement>('historyStatus'),
  history: $<HTMLDialogElement>('history'),
  closeHistory: $<HTMLButtonElement>('closeHistory'),
  newGame: $<HTMLButtonElement>('newGame'),
  historyList: $<HTMLDivElement>('historyList'),
  historySummary: $<HTMLParagraphElement>('historySummary'),
  historyEmpty: $<HTMLParagraphElement>('historyEmpty'),
};
const totals = totalsEls();

const touch = matchMedia('(hover: none)').matches;
const HINTS: Record<Mode, string> = {
  pay: `Toca una cara cuando esa persona pague. ${touch ? 'Mantén presionado un emoji' : 'Clic derecho en un emoji'} para cambiarlo y no volver a verlo.`,
  edit: 'Toca un espacio vacío para agregar a alguien que no detectamos. Toca una cara para quitarla.',
};

const SHARED_FIELDS: (keyof State)[] = ['faces', 'cost', 'currency', 'title', 'rounding'];
const PAY_FIELDS: (keyof State)[] = ['payNote', 'payQr'];
const GAME_FIELDS: (keyof State)[] = [...SHARED_FIELDS, ...PAY_FIELDS, 'image', 'share'];

let mode: Mode = 'pay';
let scanning = false;
let creating = false;
let copiedRecently = false;
let formOpen = false;
const faceEls = new Map<string, HTMLElement>();

async function migrateLegacy(prefs: Prefs): Promise<Prefs> {
  const legacy = takeLegacy();
  if (!legacy) return prefs;
  if (legacy.game) await saveGame(legacy.game);
  return { ...prefs, ...legacy.prefs, currentGameId: legacy.game?.id ?? prefs.currentGameId };
}

async function restore(): Promise<State> {
  const prefs = await migrateLegacy(loadPrefs());
  const saved = prefs.currentGameId ? await loadGame(prefs.currentGameId) : null;
  const game = saved ?? newGame();
  return { ...game, faces: refreshEmojis(game.faces, prefs.blocked), includePhoto: prefs.includePhoto, blocked: prefs.blocked };
}

let state: State = await restore();
formOpen = !state.cost;

let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flush, 200);
}

async function flush() {
  clearTimeout(saveTimer);
  const { game, prefs } = splitState(state);
  savePrefs(prefs);
  if (!game.image) return;
  await saveGame(game);
  await refreshHistoryCount();
}

window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});

const touches = (patch: Partial<State>, fields: (keyof State)[]) => fields.some((k) => k in patch);
let payDirty = false;

function queueShareSync(patch: Partial<State>) {
  const pay = touches(patch, PAY_FIELDS);
  payDirty ||= pay;
  if (pay || touches(patch, SHARED_FIELDS)) scheduleSync();
}

function update(patch: Partial<State>, sync = true) {
  const updatedAt = touches(patch, GAME_FIELDS) ? Date.now() : state.updatedAt;
  state = { ...state, ...patch, updatedAt };
  persist();
  render();
  if (sync && state.share) queueShareSync(patch);
}

function setMode(next: Mode) {
  mode = next;
  els.stage.classList.toggle('is-edit', mode === 'edit');
  els.hint.textContent = HINTS[mode];
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  });
  renderFaces();
}

function renderFaces() {
  syncFaces(els.faces, faceEls, state.faces, { interactive: true, label: (f, i) => faceLabel(f, i, mode) });
}

function renderPay() {
  const note = state.payNote.trim();
  const qr = state.payQr;
  els.payQrPreview.hidden = !qr;
  els.payQrRemove.hidden = !qr;
  els.payQrLabel.textContent = qr ? 'Cambiar QR' : 'Subir QR de Yape o Plin';
  if (qr) els.payQrPreview.src = qr;
  els.payChip.hidden = formOpen || !(note || qr);
  els.payChipNote.textContent = note || 'QR';
  els.payChipQr.hidden = !qr;
  if (qr) els.payChipQr.src = qr;
}

function renderGameCard() {
  els.gameTitle.textContent = state.title.trim() || 'Nuevo partido';
  els.gameMeta.textContent = gameMetaText(state);
  els.gameForm.hidden = !formOpen;
  els.editGame.setAttribute('aria-expanded', String(formOpen));
  renderPay();
}

const isSettled = () => {
  const t = computeTotals(state);
  return t.people > 0 && t.paid === t.people;
};

function renderProgress() {
  const hasImage = !!state.image;
  els.steps.hidden = hasImage;
  const done = [hasImage, !!state.cost, !!state.share];
  els.steps.querySelectorAll('li').forEach((li, i) => li.classList.toggle('is-done', done[i]));
  els.progressWrap.hidden = !hasImage;
  const t = renderTotals(totals, state, statusMessage(state, scanning));
  const view = progressView(t, state, true);
  els.dockSum.textContent = `${view.label} ${view.hero} · ${t.paid}/${t.people}`;
}

const shareUrl = () => touch && typeof navigator.share === 'function';

function linkActionLabel() {
  if (isSettled()) return 'Próximo partido';
  if (!state.share) return 'Crear link';
  return shareUrl() ? 'Enviar link' : 'Copiar link';
}

function renderLink() {
  const link = state.share;
  if (!copiedRecently) els.linkAction.textContent = linkActionLabel();
  els.linkAction.disabled = !state.image || scanning || creating;
  els.linkAction.title = state.image ? '' : 'Sube la foto primero';
  els.linkShare.hidden = !state.image;
  els.panelActions.hidden = !state.image;
  els.linkReady.hidden = !link;
  els.masterBox.hidden = !link;
  els.publicUrl.textContent = link ? publicUrl(link) : '';
}

function render() {
  const hasImage = !!state.image;
  els.dropzone.hidden = hasImage;
  els.stageWrap.hidden = !hasImage;
  if (hasImage && els.photo.getAttribute('src') !== state.image) els.photo.src = state.image!;
  els.scanning.hidden = !scanning;
  els.openHistory.disabled = scanning || creating;
  els.download.disabled = scanning || !hasImage;
  els.share.disabled = scanning || !hasImage;
  els.blockedBar.hidden = state.blocked.length === 0;
  els.blockedList.textContent = state.blocked.join(' ');
  renderFaces();
  renderGameCard();
  renderProgress();
  renderLink();
}

function fillForm() {
  els.title.value = state.title;
  els.payNote.value = state.payNote;
  els.currency.value = state.currency;
  els.cost.value = state.cost == null ? '' : String(state.cost);
  els.rounding.value = String(state.rounding);
  els.includePhoto.checked = state.includePhoto;
}

function announce(text: string) {
  els.announce.textContent = text;
}

async function detect() {
  const boxes = await detectFaces(els.photo);
  const aspect = els.photo.naturalWidth / els.photo.naturalHeight;
  return boxesToFaces(boxes, aspect, pickEmojis(boxes.length, [], state.blocked));
}

function makeThumb(image: string) {
  const id = state.id;
  thumbFrom(image).then(
    (thumb) => state.id === id && update({ thumb }, false),
    () => {},
  );
}

function startScan(image: string) {
  scanning = true;
  setPeek(false);
  setSync(state.share ? 'La foto nueva necesita un link nuevo.' : '');
  update({ image, faces: [], share: null, thumb: null });
  setMode('pay');
  makeThumb(image);
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
  const id = state.id;
  try {
    startScan(await fileToDataUrl(file));
    await els.photo.decode();
    const faces = await detect();
    if (state.id === id) finishScan(faces);
  } catch (err) {
    console.error(err);
    if (state.id === id) finishScan([], true);
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

const CHANGE_PHOTO = 'Se borran los pagos marcados de este partido. Para otro partido usa «Nuevo partido» en Mis partidos. ¿Cambiar la foto igual?';

els.newPhoto.addEventListener('click', () => {
  const hasPayments = state.faces.some((f) => f.paid);
  if (!hasPayments || confirm(CHANGE_PHOTO)) els.file.click();
});

const faceTarget = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('.face');

function onFaceClick(id: string) {
  if (mode === 'edit') return update({ faces: removeFace(state.faces, id) });
  const index = state.faces.findIndex((f) => f.id === id);
  update({ faces: togglePaid(state.faces, id) });
  const t = computeTotals(state);
  announce(`Persona ${index + 1} ${state.faces[index].paid ? 'pagó' : 'vuelve a deber'}. ${t.paid} de ${t.people} pagaron.`);
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

let lastBlock = { id: '', at: 0 };

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

function setPeek(on: boolean) {
  els.stage.classList.toggle('is-peek', on);
  els.peek.setAttribute('aria-pressed', String(on));
  els.peek.innerHTML = on ? '<span aria-hidden="true">🙈</span>&nbsp;Tapar caras' : '<span aria-hidden="true">👀</span>&nbsp;Ver caras';
}

els.peek.addEventListener('click', () => setPeek(!els.stage.classList.contains('is-peek')));

els.reroll.addEventListener('click', () => update({ faces: rerollEmojis(state.faces, state.blocked) }));

function setFormOpen(open: boolean) {
  formOpen = open;
  renderGameCard();
  (open ? els.title : els.editGame).focus();
}

els.editGame.addEventListener('click', () => setFormOpen(!formOpen));
els.doneGame.addEventListener('click', () => setFormOpen(false));

const parseCost = (value: string) => {
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};
els.title.addEventListener('input', () => update({ title: els.title.value }));
els.payNote.addEventListener('input', () => update({ payNote: els.payNote.value }));
els.payQrFile.addEventListener('change', async () => {
  const file = els.payQrFile.files?.[0];
  els.payQrFile.value = '';
  if (!file?.type.startsWith('image/')) return;
  try {
    update({ payQr: await qrFromFile(file) });
  } catch {
    announce('No pudimos abrir esa imagen del QR.');
  }
});
els.payQrRemove.addEventListener('click', () => update({ payQr: null }));
els.currency.addEventListener('input', () => update({ currency: els.currency.value.trim() }));
els.cost.addEventListener('input', () => update({ cost: parseCost(els.cost.value) }));
els.rounding.addEventListener('change', () => update({ rounding: parseFloat(els.rounding.value) }));
els.includePhoto.addEventListener('change', () => update({ includePhoto: els.includePhoto.checked }));

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
    els.exportMsg.textContent = `Imagen guardada: ${file.name}`;
  } catch (err) {
    console.error(err);
    els.exportMsg.textContent = 'No se pudo generar la imagen. Intenta de nuevo.';
  } finally {
    els.download.disabled = false;
  }
});

const isAbort = (err: unknown) => (err as DOMException)?.name === 'AbortError';

async function shareImage() {
  els.share.disabled = true;
  try {
    await navigator.share({ files: [await buildFile()], title: 'El Buen Pagador' });
    els.exportMsg.textContent = '';
  } catch (err) {
    if (!isAbort(err)) els.exportMsg.textContent = 'No se pudo compartir. Usa “Guardar imagen”.';
  } finally {
    els.share.disabled = false;
  }
}

const probe = new File([new Blob()], 'x.png', { type: 'image/png' });
els.share.hidden = !navigator.canShare?.({ files: [probe] });
els.share.addEventListener('click', shareImage);

let syncTimer = 0;
let syncing: Promise<void> | null = null;
let dirty = false;

function setSync(text: string, tone: 'ok' | 'busy' | 'error' | '' = '') {
  els.syncStatus.textContent = text;
  els.syncStatus.dataset.tone = tone;
  if (tone === 'error') announce(text);
}

const LIVE = 'En vivo';

const LOST_LINK: Record<number, string> = {
  404: 'El link expiró. Crea uno nuevo.',
  403: 'Este equipo ya no puede editar ese link.',
};

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
  const withPay = payDirty;
  payDirty = false;
  try {
    await pushShare(link, state, withPay);
    if (!dirty) setSync(LIVE, 'ok');
  } catch (err) {
    console.error(err);
    if (dropLinkOn(err)) return;
    payDirty ||= withPay;
    setSync('Sin conexión. Reintentando…', 'error');
    queueSync(5000);
  }
}

async function runSync() {
  await syncing;
  const link = state.share;
  if (!link || !dirty) return;
  dirty = false;
  syncing = pushOnce(link);
  await syncing;
  syncing = null;
}

const payFields = (pay?: PayInfo): Partial<State> => (pay ? { payNote: pay.note, payQr: pay.qr } : {});

async function pullShared(link: ShareLink) {
  try {
    const loaded = await loadShare(link, false, true);
    if (state.share?.id === link.id) update({ ...loaded.state, ...payFields(loaded.pay) }, false);
    setSync(LIVE, 'ok');
  } catch (err) {
    if (!dropLinkOn(err)) setSync('Sin conexión: mostrando lo guardado aquí.', 'error');
  }
}

async function createLink() {
  const id = state.id;
  creating = true;
  render();
  setSync('Creando link…', 'busy');
  try {
    const share = await createShare(state);
    if (state.id === id) update({ share });
    setSync(LIVE, 'ok');
  } catch (err) {
    console.error(err);
    setSync(err instanceof ShareError ? err.message : 'No se pudo crear el link. Intenta de nuevo.', 'error');
  } finally {
    creating = false;
    render();
  }
}

async function copyText(text: string, fallback?: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallback) getSelection()?.selectAllChildren(fallback);
    return false;
  }
}

function flashCopied(btn: HTMLButtonElement, restore: () => void) {
  btn.textContent = 'Copiado ✓';
  setTimeout(restore, 1500);
}

async function sendLink(link: ShareLink) {
  const url = publicUrl(link);
  if (shareUrl()) {
    await navigator.share({ title: state.title || 'El Buen Pagador', text: '¿Quién ya pagó la cancha?', url }).catch(() => {});
    return;
  }
  if (!(await copyText(url, els.publicUrl))) return;
  copiedRecently = true;
  flashCopied(els.linkAction, () => {
    copiedRecently = false;
    renderLink();
  });
}

function onLinkAction() {
  if (isSettled()) return startNewGame(baseOf(state));
  return state.share ? sendLink(state.share) : createLink();
}

els.linkAction.addEventListener('click', onLinkAction);

els.copyMaster.addEventListener('click', async () => {
  if (state.share && (await copyText(masterUrl(state.share)))) {
    flashCopied(els.copyMaster, () => (els.copyMaster.textContent = 'Copiar link para editar'));
  }
});

async function stopSharing(link: ShareLink) {
  try {
    await deleteShare(link);
  } catch (err) {
    if (!dropLinkOn(err)) return setSync('No se pudo desactivar el link. Intenta de nuevo.', 'error');
  }
  clearTimeout(syncTimer);
  update({ share: null });
  setSync('Link desactivado.');
}

els.stopLink.addEventListener('click', () => {
  if (state.share && confirm('El link dejará de funcionar para todos. ¿Desactivarlo?')) stopSharing(state.share);
});

async function refreshHistoryCount() {
  const count = (await listGames()).length;
  els.historyCount.hidden = count === 0;
  els.historyCount.textContent = String(count);
  els.historyCountLabel.textContent = count ? `, ${count} guardados` : '';
}

async function renderHistoryList() {
  renderHistory({ list: els.historyList, summary: els.historySummary, empty: els.historyEmpty }, await listGames(), state.id);
}

async function switchTo(game: Game) {
  await flush();
  scanning = false;
  clearTimeout(syncTimer);
  dirty = false;
  payDirty = false;
  setPeek(false);
  setSync('');
  state = { ...game, faces: refreshEmojis(game.faces, state.blocked), includePhoto: state.includePhoto, blocked: state.blocked };
  formOpen = !state.cost;
  fillForm();
  setMode('pay');
  render();
  ensureThumb();
  await flush();
}

function ensureThumb() {
  if (state.image && !state.thumb) makeThumb(state.image);
}

type GameBase = Pick<Game, 'title' | 'cost' | 'currency' | 'rounding' | 'payNote' | 'payQr'>;
const baseOf = ({ title, cost, currency, rounding, payNote, payQr }: GameBase): GameBase => ({ title, cost, currency, rounding, payNote, payQr });

async function startNewGame(base: Partial<GameBase> = { currency: state.currency, rounding: state.rounding }) {
  els.history.close();
  await switchTo(newGame(base));
  setFormOpen(true);
}

async function openGame(id: string) {
  const game = await loadGame(id);
  els.history.close();
  if (!game || game.id === state.id) return;
  await switchTo(game);
  els.gameTitle.focus();
  announce(`Abriste «${els.gameTitle.textContent}».`);
  if (game.share) await pullShared(game.share);
}

async function removeGame(id: string) {
  const game = await loadGame(id);
  const name = game?.title.trim() || 'este partido';
  if (!game || !confirm(`¿Borrar «${name}» de este dispositivo? El link del grupo, si existe, sigue funcionando.`)) return;
  const ids = [...els.historyList.querySelectorAll<HTMLElement>('[data-id]')].map((li) => li.dataset.id);
  if (id === state.id) await switchTo(newGame({ currency: state.currency, rounding: state.rounding }));
  await deleteGame(id);
  await renderHistoryList();
  await refreshHistoryCount();
  els.historyStatus.textContent = `Borraste «${name}».`;
  focusAfterDelete(ids[ids.indexOf(id) + 1]);
}

function focusAfterDelete(nextId: string | undefined) {
  const next = els.historyList.querySelector<HTMLElement>(`[data-id="${nextId}"] .game-open`);
  (next ?? els.newGame).focus();
}

async function repeatGame(id: string) {
  const game = await loadGame(id);
  if (game) await startNewGame(baseOf(game));
}

const HISTORY_ACTIONS: Record<string, (id: string) => Promise<void>> = {
  open: openGame,
  repeat: repeatGame,
  delete: removeGame,
};

let historyBusy = false;

els.historyList.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  const id = btn?.closest<HTMLElement>('[data-id]')?.dataset.id;
  if (!btn || !id || historyBusy) return;
  btn.closest('details')?.removeAttribute('open');
  historyBusy = true;
  try {
    await HISTORY_ACTIONS[btn.dataset.action!](id);
  } finally {
    historyBusy = false;
  }
});

els.openHistory.addEventListener('click', async () => {
  if (els.history.open) return;
  els.historyStatus.textContent = '';
  els.history.showModal();
  await flush();
  await renderHistoryList();
});
els.closeHistory.addEventListener('click', () => els.history.close());
els.history.addEventListener('click', (e) => {
  const target = e.target as Node;
  if (target === els.history) return els.history.close();
  els.history.querySelectorAll('details.row-menu[open]').forEach((menu) => {
    if (!menu.contains(target)) menu.removeAttribute('open');
  });
});
els.newGame.addEventListener('click', () => startNewGame());

async function gameForLink(link: ShareLink): Promise<Game> {
  const existing = await findByShareId(link.id);
  return (existing && (await loadGame(existing.id))) || newGame();
}

async function openMasterLink(link: ShareLink) {
  setSync('Abriendo link maestro…', 'busy');
  try {
    const loaded = await loadShare(link, true);
    if (!loaded.canEdit) return setSync('Ese link maestro no es válido.', 'error');
    const base = await gameForLink(link);
    const image = loaded.image ?? base.image;
    const thumb = base.thumb ?? (image ? await thumbFrom(image).catch(() => null) : null);
    await switchTo({ ...base, ...loaded.state, ...payFields(loaded.pay), image, thumb, share: link, updatedAt: Date.now() });
    setSync(LIVE, 'ok');
  } catch (err) {
    console.error(err);
    setSync(err instanceof ShareError ? err.message : 'No se pudo abrir el link.', 'error');
  }
}

async function importFromMasterLink() {
  const link = parseMasterHash(location.hash);
  if (!link) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (state.share?.id === link.id) return pullShared(link);
  await openMasterLink(link);
}

window.addEventListener('hashchange', importFromMasterLink);

fillForm();
setMode('pay');
render();
refreshHistoryCount();
ensureThumb();
if (state.share) pullShared(state.share);
importFromMasterLink();
warmUp();
