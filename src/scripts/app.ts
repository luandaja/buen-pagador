import { detectFaces, warmUp } from './detect';
import { canvasToBlob, renderCard } from './export';
import {
  createShare,
  deleteShare,
  loadShare,
  masterUrl,
  parseMasterHash,
  publicUrl,
  pushShare,
  ShareError,
} from './share';
import { DEBTOR_EMOJIS, loadState, pickEmojis, saveState, uid, type Face, type State } from './state';
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
  linkHelp: $<HTMLParagraphElement>('linkHelp'),
  createLink: $<HTMLButtonElement>('createLink'),
  linkReady: $<HTMLDivElement>('linkReady'),
  publicUrl: $<HTMLInputElement>('publicUrl'),
  masterUrl: $<HTMLInputElement>('masterUrl'),
  stopLink: $<HTMLButtonElement>('stopLink'),
};
const totals = totalsEls();

type Mode = 'pay' | 'edit';

const HINTS: Record<Mode, string> = {
  pay: matchMedia('(hover: none)').matches
    ? 'Toca una cara cuando esa persona pague. Mantén presionado un emoji para cambiarlo y no volver a verlo.'
    : 'Toca una cara cuando esa persona pague. Clic derecho en un emoji para cambiarlo y no volver a verlo.',
  edit: 'Toca un espacio vacío para agregar a alguien que no detectamos. Toca una cara para quitarla.',
};

/** Campos que ven los demás en el link: si cambian, se sincroniza. */
const SHARED_FIELDS: (keyof State)[] = ['faces', 'cost', 'currency', 'title', 'rounding'];

let state: State = loadState();
let mode: Mode = 'pay';
let scanning = false;
let creating = false;
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

function update(patch: Partial<State>) {
  state = { ...state, ...patch };
  persist();
  render();
  if (state.share && SHARED_FIELDS.some((k) => k in patch)) scheduleSync();
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

function faceLabel(face: Face, index: number) {
  if (mode === 'edit') return `Quitar persona ${index + 1}`;
  return face.paid ? `Persona ${index + 1}: pagó. Tocar para deshacer` : `Persona ${index + 1}: debe. Tocar para marcar como pagado`;
}

function renderFaces() {
  syncFaces(els.faces, faceEls, state.faces, { interactive: true, label: faceLabel });
}

function statusMessage() {
  if (!state.image) return 'Sube una foto para empezar.';
  if (scanning) return 'Contando jugadores…';
  if (state.faces.length === 0) return 'Agrega a los jugadores tocando sus caras.';
  if (!state.cost) return 'Pon el costo de la cancha para ver la cuota.';
  return undefined;
}

function renderBlocked() {
  els.blockedBar.hidden = state.blocked.length === 0;
  els.blockedList.textContent = state.blocked.join(' ');
}

function renderLink() {
  const link = state.share;
  els.createLink.hidden = !!link;
  els.createLink.disabled = !state.image || scanning || creating;
  els.linkReady.hidden = !link;
  if (link) {
    els.publicUrl.value = publicUrl(link);
    els.masterUrl.value = masterUrl(link);
  }
}

function render() {
  const hasImage = !!state.image;
  els.dropzone.hidden = hasImage;
  els.stageWrap.hidden = !hasImage;
  if (hasImage && els.photo.getAttribute('src') !== state.image) els.photo.src = state.image!;
  els.scanning.hidden = !scanning;
  els.download.disabled = scanning;
  els.share.disabled = scanning;
  renderFaces();
  renderTotals(totals, state, statusMessage());
  renderBlocked();
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
async function fileToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('No pudimos abrir esa imagen. Prueba con un JPG o PNG.'));
      i.src = url;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function handleFile(file: File | undefined) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    els.exportMsg.textContent = 'Ese archivo no es una imagen.';
    return;
  }
  try {
    const dataUrl = await fileToDataUrl(file);
    scanning = true;
    setPeek(false);
    els.scanText.textContent = 'Buscando caras…';
    // Una foto nueva es otro partido: el link anterior queda con su último estado.
    const hadLink = !!state.share;
    update({ image: dataUrl, faces: [], share: null });
    setSync(hadLink ? 'La foto nueva necesita un link nuevo.' : '');
    setMode('pay');
    await els.photo.decode();
    const boxes = await detectFaces(els.photo);
    const emojis = pickEmojis(boxes.length, [], state.blocked);
    const aspect = els.photo.naturalWidth / els.photo.naturalHeight;
    const faces: Face[] = boxes.map((b, i) => {
      // Caja cuadrada en píxeles, centrada en la cara detectada.
      const sidePx = Math.max(b.w * aspect, b.h);
      const w = sidePx / aspect;
      const h = sidePx;
      return { id: uid(), x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h, emoji: emojis[i], paid: false };
    });
    scanning = false;
    update({ faces });
    if (faces.length === 0) {
      setMode('edit');
      els.hint.textContent = 'No encontramos caras. Toca cada cara para agregarla a mano.';
    }
  } catch (err) {
    console.error(err);
    scanning = false;
    render();
    setMode('edit');
    els.hint.textContent = 'No pudimos detectar caras automáticamente. Toca cada cara para agregarla a mano.';
  }
}

fitStageToPhoto(els.photo, els.stageArea);

els.file.addEventListener('change', () => {
  handleFile(els.file.files?.[0]);
  els.file.value = '';
});

['dragenter', 'dragover'].forEach((type) =>
  els.dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('is-over');
  }),
);
['dragleave', 'drop'].forEach((type) =>
  els.dropzone.addEventListener(type, () => els.dropzone.classList.remove('is-over')),
);
els.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  handleFile(e.dataTransfer?.files?.[0]);
});

els.newPhoto.addEventListener('click', () => els.file.click());

// ——— Caras ———
function defaultFaceSize() {
  const ws = state.faces.map((f) => f.w).sort((a, b) => a - b);
  return ws.length ? ws[Math.floor(ws.length / 2)] : 0.1;
}

els.faces.addEventListener('click', (e) => {
  if (scanning) return;
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.face');
  if (target) {
    const id = target.dataset.id!;
    if (mode === 'pay') {
      update({ faces: state.faces.map((f) => (f.id === id ? { ...f, paid: !f.paid } : f)) });
    } else {
      update({ faces: state.faces.filter((f) => f.id !== id) });
    }
    return;
  }
  if (mode !== 'edit') return;
  const rect = els.faces.getBoundingClientRect();
  const aspect = rect.width / rect.height;
  const w = defaultFaceSize();
  const h = w * aspect;
  const cx = (e.clientX - rect.left) / rect.width;
  const cy = (e.clientY - rect.top) / rect.height;
  const [emoji] = pickEmojis(1, state.faces.map((f) => f.emoji), state.blocked);
  update({ faces: [...state.faces, { id: uid(), x: cx - w / 2, y: cy - h / 2, w, h, emoji, paid: false }] });
});

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
  b.addEventListener('click', () => setMode(b.dataset.mode as Mode)),
);

// ——— Bloquear emojis ———
// Clic derecho (o mantener presionado en el celular) sobre un emoji lo bloquea:
// todas las caras con ese emoji reciben otro y no vuelve a salir.
const MIN_AVAILABLE = 3;
let lastBlock = { id: '', at: 0 };

function blockEmojiOf(faceId: string) {
  const face = state.faces.find((f) => f.id === faceId);
  if (!face || face.paid) return;
  // Android dispara contextmenu y también nuestro long-press: evitamos doble bloqueo.
  const now = Date.now();
  if (lastBlock.id === faceId && now - lastBlock.at < 1000) return;
  lastBlock = { id: faceId, at: now };

  const emoji = face.emoji;
  const remaining = DEBTOR_EMOJIS.filter((e) => !state.blocked.includes(e) && e !== emoji);
  if (remaining.length < MIN_AVAILABLE) {
    els.hint.textContent = `Quedan muy pocos emojis. Restaura los bloqueados para seguir cambiando.`;
    return;
  }
  const blocked = [...state.blocked, emoji];
  const keep = state.faces.filter((f) => f.emoji !== emoji).map((f) => f.emoji);
  const targets = state.faces.filter((f) => f.emoji === emoji);
  const fresh = pickEmojis(targets.length, keep, blocked);
  update({
    blocked,
    faces: state.faces.map((f) => (f.emoji === emoji ? { ...f, emoji: fresh.shift()! } : f)),
  });
  els.hint.textContent = `Listo, ${emoji} no vuelve a salir.`;
  faceEls.get(faceId)?.classList.add('is-swapped');
  setTimeout(() => faceEls.get(faceId)?.classList.remove('is-swapped'), 400);
}

els.faces.addEventListener('contextmenu', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.face');
  if (!target || scanning) return;
  e.preventDefault();
  blockEmojiOf(target.dataset.id!);
});

// Long-press para iOS (Safari no dispara contextmenu en botones).
let pressTimer = 0;
let suppressClick = false;
els.faces.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.face');
  if (!target) return;
  clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => {
    suppressClick = true;
    blockEmojiOf(target.dataset.id!);
  }, 550);
});
['pointerup', 'pointercancel', 'pointerleave', 'pointermove'].forEach((type) =>
  els.faces.addEventListener(type, (e) => {
    if (type === 'pointermove' && (e as PointerEvent).pointerType !== 'touch') return;
    clearTimeout(pressTimer);
  }),
);
// Evita que el "click" posterior al long-press marque la cara como pagada.
els.faces.addEventListener(
  'click',
  (e) => {
    if (suppressClick) {
      suppressClick = false;
      e.stopImmediatePropagation();
    }
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

els.reroll.addEventListener('click', () => {
  const emojis = pickEmojis(state.faces.length, [], state.blocked);
  update({ faces: state.faces.map((f, i) => ({ ...f, emoji: emojis[i] })) });
});

// ——— Formulario ———
fillForm();

els.title.addEventListener('input', () => update({ title: els.title.value }));
els.currency.addEventListener('input', () => update({ currency: els.currency.value.trim() }));
els.cost.addEventListener('input', () => {
  const n = parseFloat(els.cost.value);
  update({ cost: Number.isFinite(n) && n > 0 ? n : null });
});
els.rounding.addEventListener('change', () => update({ rounding: parseFloat(els.rounding.value) }));
els.includePhoto.addEventListener('change', () => update({ includePhoto: els.includePhoto.checked }));

// ——— Exportar ———
function fileName() {
  const slug = (state.title || 'cancha')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `buen-pagador-${slug || 'cancha'}.png`;
}

async function buildFile() {
  const canvas = await renderCard(state);
  const blob = await canvasToBlob(canvas);
  return new File([blob], fileName(), { type: 'image/png' });
}

els.download.addEventListener('click', async () => {
  els.download.disabled = true;
  els.exportMsg.textContent = 'Generando imagen…';
  try {
    const file = await buildFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    els.exportMsg.textContent = `Imagen descargada: ${file.name}`;
  } catch (err) {
    console.error(err);
    els.exportMsg.textContent = 'No se pudo generar la imagen. Intenta de nuevo.';
  } finally {
    els.download.disabled = false;
  }
});

const probe = new File([new Blob()], 'x.png', { type: 'image/png' });
if (navigator.canShare?.({ files: [probe] })) {
  els.share.hidden = false;
  els.share.addEventListener('click', async () => {
    els.share.disabled = true;
    try {
      const file = await buildFile();
      await navigator.share({ files: [file], title: 'El Buen Pagador' });
      els.exportMsg.textContent = '';
    } catch (err) {
      if ((err as DOMException).name !== 'AbortError') {
        console.error(err);
        els.exportMsg.textContent = 'No se pudo compartir. Usa “Descargar imagen”.';
      }
    } finally {
      els.share.disabled = false;
    }
  });
}

// ——— Link compartido ———
let syncTimer = 0;
let syncing: Promise<void> | null = null;
let dirty = false;

function setSync(text: string, tone: 'ok' | 'busy' | 'error' | '' = '') {
  els.syncStatus.textContent = text;
  els.syncStatus.dataset.tone = tone;
}

/** Si el servidor dice que el link ya no sirve, lo soltamos. */
function dropLinkOn(err: unknown): boolean {
  if (err instanceof ShareError && (err.status === 404 || err.status === 403)) {
    update({ share: null });
    setSync(err.status === 404 ? 'El link expiró. Crea uno nuevo.' : 'Este equipo ya no puede editar ese link.', 'error');
    return true;
  }
  return false;
}

function scheduleSync(delay = 800) {
  dirty = true;
  setSync('Guardando…', 'busy');
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(runSync, delay);
}

async function runSync() {
  if (syncing) {
    // Hay un envío en curso: reintentamos cuando termine.
    await syncing;
  }
  const link = state.share;
  if (!link || !dirty) return;
  dirty = false;
  syncing = (async () => {
    try {
      await pushShare(link, state);
      if (!dirty) setSync('Al día ✓', 'ok');
    } catch (err) {
      console.error(err);
      if (dropLinkOn(err)) return;
      setSync('Sin conexión. Reintentando…', 'error');
      scheduleSync(5000);
    }
  })();
  await syncing;
  syncing = null;
}

els.createLink.addEventListener('click', async () => {
  if (!state.image || creating) return;
  creating = true;
  renderLink();
  setSync('Creando link…', 'busy');
  try {
    const link = await createShare(state);
    update({ share: link });
    setSync('Al día ✓', 'ok');
  } catch (err) {
    console.error(err);
    setSync(err instanceof ShareError ? err.message : 'No se pudo crear el link. Intenta de nuevo.', 'error');
  } finally {
    creating = false;
    renderLink();
  }
});

document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const input = $<HTMLInputElement>(btn.dataset.copy!);
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      // Sin permiso de portapapeles: dejamos el texto seleccionado para copiarlo a mano.
      input.select();
      return;
    }
    btn.textContent = 'Copiado';
    setTimeout(() => (btn.textContent = 'Copiar'), 1500);
  }),
);

els.stopLink.addEventListener('click', async () => {
  const link = state.share;
  if (!link) return;
  if (!confirm('El link dejará de funcionar para todos. ¿Dejar de compartir?')) return;
  try {
    await deleteShare(link);
  } catch (err) {
    if (!dropLinkOn(err)) {
      setSync('No se pudo borrar el link. Intenta de nuevo.', 'error');
      return;
    }
  }
  clearTimeout(syncTimer);
  update({ share: null });
  setSync('Link borrado.', '');
});

/** Abre un link maestro (#editar=…) y carga ese partido para editarlo aquí. */
async function importFromMasterLink() {
  const link = parseMasterHash(location.hash);
  if (!link) return;
  history.replaceState(null, '', location.pathname + location.search);
  if (state.share?.id === link.id) return;
  if (state.image && !confirm('Este link reemplaza la foto y los pagos que tienes abiertos aquí. ¿Continuar?')) return;

  setSync('Abriendo link maestro…', 'busy');
  try {
    const loaded = await loadShare(link, true);
    if (!loaded.canEdit) {
      setSync('Ese link maestro no es válido.', 'error');
      return;
    }
    setPeek(false);
    update({ ...loaded.state, image: loaded.image ?? null, share: link });
    fillForm();
    setSync('Al día ✓', 'ok');
  } catch (err) {
    console.error(err);
    setSync(err instanceof ShareError ? err.message : 'No se pudo abrir el link.', 'error');
  }
}

window.addEventListener('hashchange', importFromMasterLink);

// ——— Inicio ———
setMode('pay');
render();
if (state.share) setSync('Al día ✓', 'ok');
importFromMasterLink();
warmUp();
