import { es } from '../i18n/es';
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
import { byId, fitStageToPhoto, gameMetaText, progressElements, progressView, renderTotals, syncFaces } from './view';

const elements = {
  dropzone: byId<HTMLLabelElement>('dropzone'),
  file: byId<HTMLInputElement>('file'),
  stageWrap: byId<HTMLDivElement>('stageWrap'),
  stageArea: byId<HTMLDivElement>('stageArea'),
  stage: byId<HTMLDivElement>('stage'),
  photo: byId<HTMLImageElement>('photo'),
  faces: byId<HTMLDivElement>('faces'),
  scanning: byId<HTMLDivElement>('scanning'),
  scanText: byId<HTMLParagraphElement>('scanText'),
  hint: byId<HTMLParagraphElement>('hint'),
  blockedBar: byId<HTMLParagraphElement>('blockedBar'),
  blockedList: byId<HTMLSpanElement>('blockedList'),
  unblock: byId<HTMLButtonElement>('unblock'),
  reroll: byId<HTMLButtonElement>('reroll'),
  peek: byId<HTMLButtonElement>('peek'),
  newPhoto: byId<HTMLButtonElement>('newPhoto'),
  gameTitle: byId<HTMLHeadingElement>('gameTitle'),
  gameMeta: byId<HTMLParagraphElement>('gameMeta'),
  editGame: byId<HTMLButtonElement>('editGame'),
  gameForm: byId<HTMLDivElement>('gameForm'),
  doneGame: byId<HTMLButtonElement>('doneGame'),
  title: byId<HTMLInputElement>('title'),
  payNote: byId<HTMLTextAreaElement>('payNote'),
  payQrFile: byId<HTMLInputElement>('payQrFile'),
  payQrPreview: byId<HTMLImageElement>('payQrPreview'),
  payQrLabel: byId<HTMLSpanElement>('payQrLabel'),
  payQrRemove: byId<HTMLButtonElement>('payQrRemove'),
  payChip: byId<HTMLParagraphElement>('payChip'),
  payChipQr: byId<HTMLImageElement>('payChipQr'),
  payChipNote: byId<HTMLSpanElement>('payChipNote'),
  currency: byId<HTMLInputElement>('currency'),
  cost: byId<HTMLInputElement>('cost'),
  rounding: byId<HTMLSelectElement>('rounding'),
  steps: byId<HTMLOListElement>('steps'),
  progressWrap: byId<HTMLDivElement>('progressWrap'),
  dockSum: byId<HTMLParagraphElement>('dockSum'),
  includePhoto: byId<HTMLInputElement>('includePhoto'),
  download: byId<HTMLButtonElement>('download'),
  share: byId<HTMLButtonElement>('share'),
  exportMsg: byId<HTMLParagraphElement>('exportMsg'),
  syncStatus: byId<HTMLSpanElement>('syncStatus'),
  linkShare: byId<HTMLElement>('linkShare'),
  panelActions: document.querySelector<HTMLDivElement>('.panel-actions')!,
  linkAction: byId<HTMLButtonElement>('linkAction'),
  linkReady: byId<HTMLDivElement>('linkReady'),
  publicUrl: byId<HTMLSpanElement>('publicUrl'),
  masterBox: byId<HTMLDivElement>('masterBox'),
  copyMaster: byId<HTMLButtonElement>('copyMaster'),
  stopLink: byId<HTMLButtonElement>('stopLink'),
  announce: byId<HTMLParagraphElement>('announce'),
  openHistory: byId<HTMLButtonElement>('openHistory'),
  historyCount: byId<HTMLSpanElement>('historyCount'),
  historyCountLabel: byId<HTMLSpanElement>('historyCountLabel'),
  historyStatus: byId<HTMLParagraphElement>('historyStatus'),
  history: byId<HTMLDialogElement>('history'),
  closeHistory: byId<HTMLButtonElement>('closeHistory'),
  newGame: byId<HTMLButtonElement>('newGame'),
  historyList: byId<HTMLDivElement>('historyList'),
  historySummary: byId<HTMLParagraphElement>('historySummary'),
  historyEmpty: byId<HTMLParagraphElement>('historyEmpty'),
};
const progressOutputs = progressElements();

const isTouchDevice = matchMedia('(hover: none)').matches;
const HINTS: Record<Mode, string> = {
  pay: isTouchDevice ? es.hints.payTouch : es.hints.payMouse,
  edit: es.hints.edit,
};

const SHARED_FIELDS: (keyof State)[] = ['faces', 'cost', 'currency', 'title', 'rounding'];
const PAY_FIELDS: (keyof State)[] = ['payNote', 'payQr'];
const GAME_FIELDS: (keyof State)[] = [...SHARED_FIELDS, ...PAY_FIELDS, 'image', 'share'];

const SAVE_DEBOUNCE_MS = 200;
const SYNC_DEBOUNCE_MS = 800;
const SYNC_RETRY_MS = 5000;
const COPIED_FEEDBACK_MS = 1500;
const OBJECT_URL_LIFETIME_MS = 5000;
const LONG_PRESS_MS = 550;
const REPEATED_BLOCK_MS = 1000;
const SWAP_ANIMATION_MS = 400;

let mode: Mode = 'pay';
let scanning = false;
let creating = false;
let copiedRecently = false;
let formOpen = false;
const faceMarkers = new Map<string, HTMLElement>();

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
  saveTimer = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
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

const touches = (patch: Partial<State>, fields: (keyof State)[]) => fields.some((field) => field in patch);
let payNeedsSync = false;

function queueShareSync(patch: Partial<State>) {
  const payChanged = touches(patch, PAY_FIELDS);
  payNeedsSync ||= payChanged;
  if (payChanged || touches(patch, SHARED_FIELDS)) scheduleSync();
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
  elements.stage.classList.toggle('is-edit', mode === 'edit');
  elements.hint.textContent = HINTS[mode];
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
  renderFaces();
}

function renderFaces() {
  syncFaces(elements.faces, faceMarkers, state.faces, { interactive: true, label: (face, index) => faceLabel(face, index, mode) });
}

function renderPay() {
  const note = state.payNote.trim();
  const qrImage = state.payQr;
  elements.payQrPreview.hidden = !qrImage;
  elements.payQrRemove.hidden = !qrImage;
  elements.payQrLabel.textContent = qrImage ? es.pay.changeQr : es.pay.uploadQr;
  if (qrImage) elements.payQrPreview.src = qrImage;
  elements.payChip.hidden = formOpen || !(note || qrImage);
  elements.payChipNote.textContent = note || es.pay.chipQrOnly;
  elements.payChipQr.hidden = !qrImage;
  if (qrImage) elements.payChipQr.src = qrImage;
}

function renderGameCard() {
  elements.gameTitle.textContent = state.title.trim() || es.game.newGame;
  elements.gameMeta.textContent = gameMetaText(state);
  elements.gameForm.hidden = !formOpen;
  elements.editGame.setAttribute('aria-expanded', String(formOpen));
  renderPay();
}

const isSettled = () => {
  const totals = computeTotals(state);
  return totals.people > 0 && totals.paid === totals.people;
};

function renderProgress() {
  const hasImage = !!state.image;
  elements.steps.hidden = hasImage;
  const completedSteps = [hasImage, !!state.cost, !!state.share];
  elements.steps.querySelectorAll('li').forEach((step, index) => step.classList.toggle('is-done', completedSteps[index]));
  elements.progressWrap.hidden = !hasImage;
  const totals = renderTotals(progressOutputs, state, statusMessage(state, scanning));
  const view = progressView(totals, state, true);
  elements.dockSum.textContent = `${view.label} ${view.hero} · ${totals.paid}/${totals.people}`;
}

const canShareUrl = () => isTouchDevice && typeof navigator.share === 'function';

function linkActionLabel() {
  if (isSettled()) return es.share.next;
  if (!state.share) return es.share.create;
  return canShareUrl() ? es.share.send : es.share.copy;
}

function renderLink() {
  const link = state.share;
  if (!copiedRecently) elements.linkAction.textContent = linkActionLabel();
  elements.linkAction.disabled = !state.image || scanning || creating;
  elements.linkAction.title = state.image ? '' : es.share.needsPhoto;
  elements.linkShare.hidden = !state.image;
  elements.panelActions.hidden = !state.image;
  elements.linkReady.hidden = !link;
  elements.masterBox.hidden = !link;
  elements.publicUrl.textContent = link ? publicUrl(link) : '';
}

function render() {
  const hasImage = !!state.image;
  elements.dropzone.hidden = hasImage;
  elements.stageWrap.hidden = !hasImage;
  if (hasImage && elements.photo.getAttribute('src') !== state.image) elements.photo.src = state.image!;
  elements.scanning.hidden = !scanning;
  elements.openHistory.disabled = scanning || creating;
  elements.download.disabled = scanning || !hasImage;
  elements.share.disabled = scanning || !hasImage;
  elements.blockedBar.hidden = state.blocked.length === 0;
  elements.blockedList.textContent = state.blocked.join(' ');
  renderFaces();
  renderGameCard();
  renderProgress();
  renderLink();
}

function fillForm() {
  elements.title.value = state.title;
  elements.payNote.value = state.payNote;
  elements.currency.value = state.currency;
  elements.cost.value = state.cost == null ? '' : String(state.cost);
  elements.rounding.value = String(state.rounding);
  elements.includePhoto.checked = state.includePhoto;
}

function announce(text: string) {
  elements.announce.textContent = text;
}

async function detect() {
  const boxes = await detectFaces(elements.photo);
  const aspectRatio = elements.photo.naturalWidth / elements.photo.naturalHeight;
  return boxesToFaces(boxes, aspectRatio, pickEmojis(boxes.length, [], state.blocked));
}

function makeThumb(image: string) {
  const gameId = state.id;
  thumbFrom(image).then(
    (thumb) => state.id === gameId && update({ thumb }, false),
    () => {},
  );
}

function startScan(image: string) {
  scanning = true;
  setPeek(false);
  setSync(state.share ? es.share.newPhotoNeedsLink : '');
  update({ image, faces: [], share: null, thumb: null });
  setMode('pay');
  makeThumb(image);
}

function finishScan(faces: State['faces'], failed = false) {
  scanning = false;
  update({ faces });
  if (faces.length > 0) return;
  setMode('edit');
  elements.hint.textContent = failed ? es.upload.detectFailed : es.upload.noFaces;
}

async function handleFile(file: File | undefined) {
  if (!file?.type.startsWith('image/')) {
    elements.exportMsg.textContent = file ? es.upload.notImage : '';
    return;
  }
  const gameId = state.id;
  try {
    startScan(await fileToDataUrl(file));
    await elements.photo.decode();
    const faces = await detect();
    if (state.id === gameId) finishScan(faces);
  } catch (error) {
    console.error(error);
    if (state.id === gameId) finishScan([], true);
  }
}

fitStageToPhoto(elements.photo, elements.stageArea);

elements.file.addEventListener('change', () => {
  handleFile(elements.file.files?.[0]);
  elements.file.value = '';
});

const setDragOver = (isOver: boolean) => (event: Event) => {
  event.preventDefault();
  elements.dropzone.classList.toggle('is-over', isOver);
};
elements.dropzone.addEventListener('dragenter', setDragOver(true));
elements.dropzone.addEventListener('dragover', setDragOver(true));
elements.dropzone.addEventListener('dragleave', setDragOver(false));
elements.dropzone.addEventListener('drop', (event) => {
  setDragOver(false)(event);
  handleFile(event.dataTransfer?.files?.[0]);
});

elements.newPhoto.addEventListener('click', () => {
  const hasPayments = state.faces.some((face) => face.paid);
  if (!hasPayments || confirm(es.upload.changePhotoConfirm)) elements.file.click();
});

const faceTarget = (event: Event) => (event.target as HTMLElement).closest<HTMLElement>('.face');

function onFaceClick(faceId: string) {
  if (mode === 'edit') return update({ faces: removeFace(state.faces, faceId) });
  const index = state.faces.findIndex((face) => face.id === faceId);
  update({ faces: togglePaid(state.faces, faceId) });
  const totals = computeTotals(state);
  announce(es.faces.announce(index + 1, state.faces[index].paid, totals.paid, totals.people));
}

function onEmptyClick(event: MouseEvent) {
  const rect = elements.faces.getBoundingClientRect();
  const centerX = (event.clientX - rect.left) / rect.width;
  const centerY = (event.clientY - rect.top) / rect.height;
  update({ faces: addFaceAt(state.faces, centerX, centerY, rect.width / rect.height, state.blocked) });
}

elements.faces.addEventListener('click', (event) => {
  if (scanning) return;
  const target = faceTarget(event);
  if (target) onFaceClick(target.dataset.id!);
  else if (mode === 'edit') onEmptyClick(event);
});

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) =>
  button.addEventListener('click', () => setMode(button.dataset.mode as Mode)),
);

let lastBlock = { faceId: '', time: 0 };

function isRepeatedBlock(faceId: string) {
  const now = Date.now();
  const repeated = lastBlock.faceId === faceId && now - lastBlock.time < REPEATED_BLOCK_MS;
  lastBlock = { faceId, time: now };
  return repeated;
}

function blockEmojiOf(faceId: string) {
  if (isRepeatedBlock(faceId)) return;
  const result = blockEmoji(state, faceId);
  if (!result.ok) {
    if (result.reason === 'too-few') elements.hint.textContent = es.hints.tooFewEmojis;
    return;
  }
  update({ faces: result.faces, blocked: result.blocked });
  elements.hint.textContent = es.hints.blockedEmoji(result.emoji);
  const marker = faceMarkers.get(faceId);
  marker?.classList.add('is-swapped');
  setTimeout(() => marker?.classList.remove('is-swapped'), SWAP_ANIMATION_MS);
}

elements.faces.addEventListener('contextmenu', (event) => {
  const target = faceTarget(event);
  if (!target || scanning) return;
  event.preventDefault();
  blockEmojiOf(target.dataset.id!);
});

let pressTimer = 0;
let suppressClick = false;
elements.faces.addEventListener('pointerdown', (event) => {
  const target = faceTarget(event);
  if (event.pointerType !== 'touch' || !target) return;
  clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => {
    suppressClick = true;
    blockEmojiOf(target.dataset.id!);
  }, LONG_PRESS_MS);
});
const cancelPress = () => clearTimeout(pressTimer);
for (const type of ['pointerup', 'pointercancel', 'pointerleave']) elements.faces.addEventListener(type, cancelPress);
elements.faces.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'touch') cancelPress();
});
elements.faces.addEventListener(
  'click',
  (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.stopImmediatePropagation();
  },
  true,
);

elements.unblock.addEventListener('click', () => {
  update({ blocked: [] });
  elements.hint.textContent = HINTS[mode];
});

function setPeek(isPeeking: boolean) {
  elements.stage.classList.toggle('is-peek', isPeeking);
  elements.peek.setAttribute('aria-pressed', String(isPeeking));
  elements.peek.innerHTML = `<span aria-hidden="true">${isPeeking ? '🙈' : '👀'}</span>&nbsp;${isPeeking ? es.toolbar.unpeek : es.toolbar.peek}`;
}

elements.peek.addEventListener('click', () => setPeek(!elements.stage.classList.contains('is-peek')));

elements.reroll.addEventListener('click', () => update({ faces: rerollEmojis(state.faces, state.blocked) }));

function setFormOpen(isOpen: boolean) {
  formOpen = isOpen;
  renderGameCard();
  (isOpen ? elements.title : elements.editGame).focus();
}

elements.editGame.addEventListener('click', () => setFormOpen(!formOpen));
elements.doneGame.addEventListener('click', () => setFormOpen(false));

const parseCost = (value: string) => {
  const amount = parseFloat(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};
elements.title.addEventListener('input', () => update({ title: elements.title.value }));
elements.payNote.addEventListener('input', () => update({ payNote: elements.payNote.value }));
elements.payQrFile.addEventListener('change', async () => {
  const file = elements.payQrFile.files?.[0];
  elements.payQrFile.value = '';
  if (!file?.type.startsWith('image/')) return;
  try {
    update({ payQr: await qrFromFile(file) });
  } catch {
    announce(es.pay.qrError);
  }
});
elements.payQrRemove.addEventListener('click', () => update({ payQr: null }));
elements.currency.addEventListener('input', () => update({ currency: elements.currency.value.trim() }));
elements.cost.addEventListener('input', () => update({ cost: parseCost(elements.cost.value) }));
elements.rounding.addEventListener('change', () => update({ rounding: parseFloat(elements.rounding.value) }));
elements.includePhoto.addEventListener('change', () => update({ includePhoto: elements.includePhoto.checked }));

async function buildFile() {
  const blob = await canvasToBlob(await renderCard(state));
  return new File([blob], fileName(state.title), { type: 'image/png' });
}

function downloadFile(file: File) {
  const objectUrl = URL.createObjectURL(file);
  const downloadLink = document.createElement('a');
  downloadLink.href = objectUrl;
  downloadLink.download = file.name;
  downloadLink.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_LIFETIME_MS);
}

elements.download.addEventListener('click', async () => {
  elements.download.disabled = true;
  elements.exportMsg.textContent = es.image.generating;
  try {
    const file = await buildFile();
    downloadFile(file);
    elements.exportMsg.textContent = es.image.saved(file.name);
  } catch (error) {
    console.error(error);
    elements.exportMsg.textContent = es.image.failed;
  } finally {
    elements.download.disabled = false;
  }
});

const isAbort = (error: unknown) => (error as DOMException)?.name === 'AbortError';

async function shareImage() {
  elements.share.disabled = true;
  try {
    await navigator.share({ files: [await buildFile()], title: es.meta.title });
    elements.exportMsg.textContent = '';
  } catch (error) {
    if (!isAbort(error)) elements.exportMsg.textContent = es.image.shareFailed;
  } finally {
    elements.share.disabled = false;
  }
}

const probeFile = new File([new Blob()], 'probe.png', { type: 'image/png' });
elements.share.hidden = !navigator.canShare?.({ files: [probeFile] });
elements.share.addEventListener('click', shareImage);

let syncTimer = 0;
let syncInFlight: Promise<void> | null = null;
let syncPending = false;

function setSync(text: string, tone: 'ok' | 'busy' | 'error' | '' = '') {
  elements.syncStatus.textContent = text;
  elements.syncStatus.dataset.tone = tone;
  if (tone === 'error') announce(text);
}

const LIVE_STATUS = es.share.live;

const LOST_LINK_MESSAGES: Record<number, string> = {
  404: es.share.expired,
  403: es.share.noLongerEditor,
};

function dropLinkOnLoss(error: unknown): boolean {
  const message = error instanceof ShareError ? LOST_LINK_MESSAGES[error.status] : undefined;
  if (!message) return false;
  update({ share: null });
  setSync(message, 'error');
  return true;
}

function queueSync(delay: number) {
  syncPending = true;
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(runSync, delay);
}

function scheduleSync() {
  setSync(es.share.saving, 'busy');
  queueSync(SYNC_DEBOUNCE_MS);
}

async function pushOnce(link: ShareLink) {
  const withPay = payNeedsSync;
  payNeedsSync = false;
  try {
    await pushShare(link, state, withPay);
    if (!syncPending) setSync(LIVE_STATUS, 'ok');
  } catch (error) {
    console.error(error);
    if (dropLinkOnLoss(error)) return;
    payNeedsSync ||= withPay;
    setSync(es.share.offlineRetry, 'error');
    queueSync(SYNC_RETRY_MS);
  }
}

async function runSync() {
  await syncInFlight;
  const link = state.share;
  if (!link || !syncPending) return;
  syncPending = false;
  syncInFlight = pushOnce(link);
  await syncInFlight;
  syncInFlight = null;
}

const payFields = (pay?: PayInfo): Partial<State> => (pay ? { payNote: pay.note, payQr: pay.qr } : {});

async function pullShared(link: ShareLink) {
  try {
    const loaded = await loadShare(link, false, true);
    if (state.share?.id === link.id) update({ ...loaded.state, ...payFields(loaded.pay) }, false);
    setSync(LIVE_STATUS, 'ok');
  } catch (error) {
    if (!dropLinkOnLoss(error)) setSync(es.share.offlineLocal, 'error');
  }
}

async function createLink() {
  const gameId = state.id;
  creating = true;
  render();
  setSync(es.share.creating, 'busy');
  try {
    const share = await createShare(state);
    if (state.id === gameId) update({ share });
    setSync(LIVE_STATUS, 'ok');
  } catch (error) {
    console.error(error);
    setSync(error instanceof ShareError ? error.message : es.share.createFailed, 'error');
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

function flashCopied(button: HTMLButtonElement, restore: () => void) {
  button.textContent = es.share.copied;
  setTimeout(restore, COPIED_FEEDBACK_MS);
}

async function sendLink(link: ShareLink) {
  const url = publicUrl(link);
  if (canShareUrl()) {
    await navigator.share({ title: state.title || es.meta.title, text: es.share.sendText, url }).catch(() => {});
    return;
  }
  if (!(await copyText(url, elements.publicUrl))) return;
  copiedRecently = true;
  flashCopied(elements.linkAction, () => {
    copiedRecently = false;
    renderLink();
  });
}

function onLinkAction() {
  if (isSettled()) return startNewGame(baseOf(state));
  return state.share ? sendLink(state.share) : createLink();
}

elements.linkAction.addEventListener('click', onLinkAction);

elements.copyMaster.addEventListener('click', async () => {
  if (state.share && (await copyText(masterUrl(state.share)))) {
    flashCopied(elements.copyMaster, () => (elements.copyMaster.textContent = es.share.copyMaster));
  }
});

async function stopSharing(link: ShareLink) {
  try {
    await deleteShare(link);
  } catch (error) {
    if (!dropLinkOnLoss(error)) return setSync(es.share.stopFailed, 'error');
  }
  clearTimeout(syncTimer);
  update({ share: null });
  setSync(es.share.stopped);
}

elements.stopLink.addEventListener('click', () => {
  if (state.share && confirm(es.share.stopConfirm)) stopSharing(state.share);
});

async function refreshHistoryCount() {
  const count = (await listGames()).length;
  elements.historyCount.hidden = count === 0;
  elements.historyCount.textContent = String(count);
  elements.historyCountLabel.textContent = es.history.countLabel(count);
}

async function renderHistoryList() {
  renderHistory({ list: elements.historyList, summary: elements.historySummary, empty: elements.historyEmpty }, await listGames(), state.id);
}

async function switchTo(game: Game) {
  await flush();
  scanning = false;
  clearTimeout(syncTimer);
  syncPending = false;
  payNeedsSync = false;
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
  elements.history.close();
  await switchTo(newGame(base));
  setFormOpen(true);
}

async function openGame(gameId: string) {
  const game = await loadGame(gameId);
  elements.history.close();
  if (!game || game.id === state.id) return;
  await switchTo(game);
  elements.gameTitle.focus();
  announce(es.history.opened(elements.gameTitle.textContent ?? ''));
  if (game.share) await pullShared(game.share);
}

async function removeGame(gameId: string) {
  const game = await loadGame(gameId);
  const name = game?.title.trim() || es.history.thisGame;
  if (!game || !confirm(es.history.removeConfirm(name))) return;
  const rowIds = [...elements.historyList.querySelectorAll<HTMLElement>('[data-id]')].map((row) => row.dataset.id);
  if (gameId === state.id) await switchTo(newGame({ currency: state.currency, rounding: state.rounding }));
  await deleteGame(gameId);
  await renderHistoryList();
  await refreshHistoryCount();
  elements.historyStatus.textContent = es.history.removed(name);
  focusAfterDelete(rowIds[rowIds.indexOf(gameId) + 1]);
}

function focusAfterDelete(nextId: string | undefined) {
  const nextRow = elements.historyList.querySelector<HTMLElement>(`[data-id="${nextId}"] .game-open`);
  (nextRow ?? elements.newGame).focus();
}

async function repeatGame(gameId: string) {
  const game = await loadGame(gameId);
  if (game) await startNewGame(baseOf(game));
}

const HISTORY_ACTIONS: Record<string, (gameId: string) => Promise<void>> = {
  open: openGame,
  repeat: repeatGame,
  delete: removeGame,
};

let historyBusy = false;

elements.historyList.addEventListener('click', async (event) => {
  const actionButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  const gameId = actionButton?.closest<HTMLElement>('[data-id]')?.dataset.id;
  if (!actionButton || !gameId || historyBusy) return;
  actionButton.closest('details')?.removeAttribute('open');
  historyBusy = true;
  try {
    await HISTORY_ACTIONS[actionButton.dataset.action!](gameId);
  } finally {
    historyBusy = false;
  }
});

elements.openHistory.addEventListener('click', async () => {
  if (elements.history.open) return;
  elements.historyStatus.textContent = '';
  elements.history.showModal();
  await flush();
  await renderHistoryList();
});
elements.closeHistory.addEventListener('click', () => elements.history.close());
elements.history.addEventListener('click', (event) => {
  const target = event.target as Node;
  if (target === elements.history) return elements.history.close();
  elements.history.querySelectorAll('details.row-menu[open]').forEach((menu) => {
    if (!menu.contains(target)) menu.removeAttribute('open');
  });
});
elements.newGame.addEventListener('click', () => startNewGame());

async function gameForLink(link: ShareLink): Promise<Game> {
  const existing = await findByShareId(link.id);
  return (existing && (await loadGame(existing.id))) || newGame();
}

async function openMasterLink(link: ShareLink) {
  setSync(es.share.openingMaster, 'busy');
  try {
    const loaded = await loadShare(link, true);
    if (!loaded.canEdit) return setSync(es.share.invalidMaster, 'error');
    const base = await gameForLink(link);
    const image = loaded.image ?? base.image;
    const thumb = base.thumb ?? (image ? await thumbFrom(image).catch(() => null) : null);
    await switchTo({ ...base, ...loaded.state, ...payFields(loaded.pay), image, thumb, share: link, updatedAt: Date.now() });
    setSync(LIVE_STATUS, 'ok');
  } catch (error) {
    console.error(error);
    setSync(error instanceof ShareError ? error.message : es.share.openFailed, 'error');
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
