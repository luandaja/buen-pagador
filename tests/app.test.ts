// @vitest-environment node
// Integración del editor: HTML real de la página + API real en proceso + IndexedDB en memoria.
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore } from '../src/lib/store';
import Index from '../src/pages/index.astro';
import { createShare, loadShare } from '../src/scripts/share';
import { DEBTOR_EMOJIS, defaultPrefs, defaultState, newGame, type Game, type State } from '../src/scripts/state';
import { useApiFetch } from './helpers/api';
import { $, click, eventually, input, mount, renderPage, unmount } from './helpers/dom';

const mocks = vi.hoisted(() => ({
  boxes: [] as { x: number; y: number; w: number; h: number; score: number }[],
  detectFaces: vi.fn(),
  renderCard: vi.fn(),
  fileToDataUrl: vi.fn(),
}));

vi.mock('../src/scripts/detect', () => ({ detectFaces: mocks.detectFaces, warmUp: vi.fn() }));
vi.mock('../src/scripts/export', () => ({ renderCard: mocks.renderCard }));
vi.mock('../src/scripts/image', () => ({
  fileToDataUrl: mocks.fileToDataUrl,
  canvasToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  shareImageBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  bytesToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,BBBB'),
  thumbFrom: vi.fn(async () => 'data:image/jpeg;base64,THUMB'),
}));

const ORIGIN = 'http://localhost:4321';
let html = '';
type Games = typeof import('../src/scripts/games');
let games: Games;

beforeAll(async () => {
  html = await renderPage(Index);
});

beforeEach(() => {
  resetStore();
  mocks.boxes = [
    { x: 0.1, y: 0.1, w: 0.1, h: 0.1, score: 0.9 },
    { x: 0.4, y: 0.1, w: 0.1, h: 0.1, score: 0.9 },
    { x: 0.7, y: 0.1, w: 0.1, h: 0.1, score: 0.9 },
  ];
  mocks.detectFaces.mockReset().mockImplementation(async () => mocks.boxes);
  mocks.renderCard.mockReset().mockImplementation(async () => ({}));
  mocks.fileToDataUrl.mockReset().mockImplementation(async () => 'data:image/jpeg;base64,AAAA');
});

afterEach(async () => {
  await unmount();
});

interface StartOptions {
  /** Partido guardado por la versión anterior (se migra al arrancar). */
  legacy?: Partial<State>;
  /** Partidos ya guardados en el historial. */
  saved?: Game[];
  /** Partido abierto al arrancar. */
  current?: string;
  hash?: string;
}

/** Monta la página, prepara el almacenamiento y arranca el script del editor. */
async function start({ legacy, saved = [], current, hash = '' }: StartOptions = {}) {
  mount(html, `${ORIGIN}/${hash}`);
  globalThis.indexedDB = new IDBFactory();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useApiFetch();
  const photo = $<HTMLImageElement>('photo');
  Object.defineProperties(photo, {
    naturalWidth: { value: 800 },
    naturalHeight: { value: 600 },
    decode: { value: async () => {} },
  });
  vi.spyOn($('faces'), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600 } as DOMRect);
  HTMLAnchorElement.prototype.click = vi.fn();
  vi.resetModules();
  games = await import('../src/scripts/games');
  for (const game of saved) await games.saveGame(game);
  if (current) localStorage.setItem('buen-pagador:prefs', JSON.stringify({ ...defaultPrefs(), currentGameId: current }));
  if (legacy) localStorage.setItem('buen-pagador:v1', JSON.stringify({ ...defaultState(), ...legacy }));
  await import('../src/scripts/app');
}

async function upload(type = 'image/jpeg') {
  const file = new File(['x'], 'foto.jpg', { type });
  const fileInput = $<HTMLInputElement>('file');
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
  fileInput.dispatchEvent(new Event('change'));
}

/** happy-dom no implementa confirm(). */
function stubConfirm(answer = true) {
  const fn = vi.fn(() => answer);
  globalThis.confirm = fn;
  return fn;
}

const masterHash = (link: { id: string; key: string; token: string }) => `#editar=${link.id}.${link.key}.${link.token}`;

const faces = () => [...document.querySelectorAll<HTMLButtonElement>('.face')];
const text = (id: string) => $(id).textContent;
const prefs = () => JSON.parse(localStorage.getItem('buen-pagador:prefs') ?? '{}');
/** El partido abierto, tal como quedó guardado en IndexedDB. */
const current = async () => games.loadGame(prefs().currentGameId);
const rows = () => [...document.querySelectorAll<HTMLElement>('.game-row')];
const rowNamed = (title: string) => rows().find((r) => r.querySelector('strong')?.textContent === title)!;

function game(extra: Partial<Game> = {}): Game {
  return {
    ...newGame(),
    image: 'data:image/jpeg;base64,AAAA',
    cost: 90,
    faces: ['a', 'b', 'c'].map((id, i) => ({ id, x: 0.1 * i, y: 0.1, w: 0.1, h: 0.1, emoji: DEBTOR_EMOJIS[i], paid: false })),
    ...extra,
  };
}

/** Arranca con un partido con foto ya abierto. */
async function startWith(extra: Partial<Game> = {}, others: Game[] = []) {
  const g = game(extra);
  await start({ saved: [g, ...others], current: g.id });
  return g;
}

async function openHistory() {
  click($('openHistory'));
  await eventually(() => expect(rows().length).toBeGreaterThan(0));
}

describe('foto y caras', () => {
  it('empieza vacío con pasos, detecta caras y calcula la cuota', async () => {
    await start();
    expect($('dropzone').hidden).toBe(false);
    expect($('steps').hidden).toBe(false);
    expect($('progressWrap').hidden).toBe(true);
    expect($('linkShare').hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.panel-actions')!.hidden).toBe(true);
    expect($('gameForm').hidden).toBe(false);

    input($<HTMLInputElement>('cost'), '120');
    expect(document.querySelectorAll('#steps li')[1].classList.contains('is-done')).toBe(true);

    await upload();
    await eventually(() => expect(faces()).toHaveLength(3));
    expect($('stageWrap').hidden).toBe(false);
    expect($('steps').hidden).toBe(true);
    expect(text('shareOut')).toBe('S/ 40');
    expect(text('heroOut')).toBe('S/ 120');
    expect(text('gameMeta')).toBe('Cancha S/ 120 · 3 jugadores');
    expect(text('dockSum')).toBe('Te faltan S/ 120 · 0/3');

    input($<HTMLInputElement>('cost'), 'abc');
    expect(text('shareOut')).toBe('—');
    expect(text('missingOut')).toMatch(/costo/);
  });

  it('marca pagos, anuncia el avance, agrega y quita caras', async () => {
    await startWith();
    click(faces()[0]);
    expect(text('paidOut')).toBe('1/3');
    expect(text('announce')).toBe('Persona 1 pagó. 1 de 3 pagaron.');
    click(faces()[0]);
    expect(text('announce')).toBe('Persona 1 vuelve a deber. 0 de 3 pagaron.');

    click($('faces')); // en modo pagos, tocar el vacío no hace nada
    expect(faces()).toHaveLength(3);

    click(document.querySelector('[data-mode="edit"]')!);
    expect(document.querySelector('[data-mode="edit"]')!.getAttribute('aria-pressed')).toBe('true');
    click($('faces'), { clientX: 400, clientY: 300 });
    expect(faces()).toHaveLength(4);
    click(faces()[3]);
    expect(faces()).toHaveLength(3);
  });

  it('avisa si no es una imagen, si no hay caras o si la detección falla', async () => {
    await start();
    await upload('text/plain');
    expect(text('exportMsg')).toBe('Ese archivo no es una imagen.');

    mocks.boxes = [];
    await upload();
    await eventually(() => expect(text('hint')).toMatch(/No encontramos caras/));
    expect($('stage').classList.contains('is-edit')).toBe(true);

    mocks.detectFaces.mockRejectedValueOnce(new Error('sin modelo'));
    await upload();
    await eventually(() => expect(text('hint')).toMatch(/No pudimos detectar/));
  });

  it('acepta fotos arrastradas', async () => {
    await start();
    const zone = $('dropzone');
    zone.dispatchEvent(new Event('dragover', { cancelable: true }));
    expect(zone.classList.contains('is-over')).toBe(true);
    zone.dispatchEvent(new Event('dragleave'));
    expect(zone.classList.contains('is-over')).toBe(false);
    const drop = new Event('drop', { cancelable: true }) as Event & { dataTransfer: unknown };
    drop.dataTransfer = { files: [new File(['x'], 'f.jpg', { type: 'image/jpeg' })] };
    zone.dispatchEvent(drop);
    await eventually(() => expect(faces()).toHaveLength(3));
  });

  it('"Cambiar foto" pregunta si ya hay pagos marcados', async () => {
    await startWith({ faces: game().faces.map((f, i) => ({ ...f, paid: i === 0 })) });
    const open = vi.spyOn($<HTMLInputElement>('file'), 'click');
    stubConfirm(false);
    click($('newPhoto'));
    expect(open).not.toHaveBeenCalled();
    stubConfirm(true);
    click($('newPhoto'));
    expect(open).toHaveBeenCalled();
  });
});

describe('emojis', () => {
  it('clic derecho bloquea el emoji, se puede restaurar', async () => {
    await startWith();
    const before = faces()[0].querySelector('.face-emoji')!.textContent;
    faces()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(text('hint')).toBe(`Listo, ${before} no vuelve a salir.`);
    expect(text('blockedList')).toBe(before);
    // Un segundo evento inmediato (Android) no bloquea otra vez.
    faces()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(text('blockedList')).toBe(before);
    click($('unblock'));
    expect($('blockedBar').hidden).toBe(true);
  });

  it('avisa cuando quedan muy pocos emojis', async () => {
    await start({ legacy: { ...game(), blocked: DEBTOR_EMOJIS.slice(3, 20) } });
    faces()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(text('hint')).toMatch(/muy pocos emojis/);
  });

  it('mantener presionado bloquea y no marca como pagado', async () => {
    await startWith();
    const target = faces()[1];
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    await eventually(() => expect(text('hint')).toMatch(/no vuelve a salir/), 2000);
    click(target);
    expect(text('paidOut')).toBe('0/3');

    // Un toque corto se cancela al levantar el dedo o moverlo.
    for (const [type, pointerType] of [
      ['pointerdown', 'touch'],
      ['pointermove', 'touch'],
      ['pointermove', 'mouse'],
      ['pointerup', 'touch'],
      ['pointerdown', 'mouse'],
    ]) {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType }));
    }
  });

  it('ver caras y sortear otros emojis', async () => {
    await startWith();
    click($('peek'));
    expect($('stage').classList.contains('is-peek')).toBe(true);
    expect(text('peek')).toMatch(/Tapar/);
    click($('peek'));
    expect($('stage').classList.contains('is-peek')).toBe(false);
    click($('reroll'));
    expect(faces()).toHaveLength(3);
  });
});

describe('ficha del partido y guardado', () => {
  it('se pliega, se edita y guarda todo en el historial', async () => {
    await startWith({ title: 'Antes' });
    expect($('gameForm').hidden).toBe(true);
    click($('editGame'));
    expect($('gameForm').hidden).toBe(false);
    expect(document.activeElement?.id).toBe('title');

    input($<HTMLInputElement>('title'), 'Jueves');
    input($<HTMLInputElement>('currency'), ' $ ');
    input($<HTMLSelectElement>('rounding'), '1', 'change');
    const check = $<HTMLInputElement>('includePhoto');
    check.checked = false;
    check.dispatchEvent(new Event('change'));
    click($('doneGame'));
    expect($('gameForm').hidden).toBe(true);
    expect(text('gameTitle')).toBe('Jueves');

    window.dispatchEvent(new Event('pagehide'));
    await eventually(async () => expect(await current()).toMatchObject({ title: 'Jueves', currency: '$', rounding: 1 }));
    expect(prefs()).toMatchObject({ includePhoto: false });

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  it('migra el partido de la versión anterior y le genera miniatura', async () => {
    await start({ legacy: { ...game({ title: 'Viejo' }), thumb: null } });
    expect(text('gameTitle')).toBe('Viejo');
    expect(localStorage.getItem('buen-pagador:v1')).toBeNull();
    await eventually(async () => expect((await current())?.thumb).toBe('data:image/jpeg;base64,THUMB'));
    expect(text('historyCount')).toBe('1');
  });
});

describe('exportar imagen', () => {
  it('sin foto no se puede guardar', async () => {
    await start();
    expect($<HTMLButtonElement>('download').disabled).toBe(true);
  });

  it('guarda la imagen con el nombre del partido', async () => {
    await startWith({ title: 'Jueves 9 pm' });
    click($('download'));
    await eventually(() => expect(text('exportMsg')).toBe('Imagen guardada: buen-pagador-jueves-9-pm.png'));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it('avisa si no se pudo generar', async () => {
    await startWith();
    mocks.renderCard.mockRejectedValueOnce(new Error('canvas'));
    click($('download'));
    await eventually(() => expect(text('exportMsg')).toMatch(/No se pudo generar/));
  });

  it('comparte la imagen', async () => {
    await startWith();
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    const share = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(abort).mockRejectedValueOnce(new Error('falló'));
    Object.assign(navigator, { share });
    click($('share'));
    await eventually(() => expect(share).toHaveBeenCalledTimes(1));
    click($('share'));
    await eventually(() => expect(share).toHaveBeenCalledTimes(2));
    expect(text('exportMsg')).toBe('');
    click($('share'));
    await eventually(() => expect(text('exportMsg')).toMatch(/No se pudo compartir/));
  });
});

describe('link para el grupo', () => {
  async function withLink() {
    await startWith();
    click($('linkAction'));
    await eventually(() => expect(text('syncStatus')).toBe('En vivo'));
  }

  it('crea el link, sincroniza pagos y lo desactiva', async () => {
    await withLink();
    const url = text('publicUrl')!;
    expect(url).toMatch(/\/ver#[A-Za-z0-9]{10}\.[\w-]{43}$/);
    expect(text('linkAction')).toBe('Copiar link');
    expect($('masterBox').hidden).toBe(false);

    click(faces()[0]);
    expect(text('syncStatus')).toBe('Guardando…');
    await eventually(() => expect(text('syncStatus')).toBe('En vivo'));
    const [id, key] = new URL(url).hash.slice(1).split('.');
    expect((await loadShare({ id, key }, false)).state.faces[0].paid).toBe(true);

    stubConfirm(false);
    click($('stopLink'));
    expect($('linkReady').hidden).toBe(false);
    stubConfirm(true);
    click($('stopLink'));
    await eventually(() => expect(text('syncStatus')).toBe('Link desactivado.'));
    await expect(loadShare({ id, key }, false)).rejects.toMatchObject({ status: 404 });
  });

  it('copia el link del grupo y el de edición', async () => {
    await withLink();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('no'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    click($('linkAction'));
    await eventually(() => expect(text('linkAction')).toBe('Copiado ✓'));
    expect(writeText).toHaveBeenLastCalledWith(text('publicUrl'));

    click($('copyMaster'));
    await eventually(() => expect(text('copyMaster')).toBe('Copiado ✓'));
    expect(writeText.mock.lastCall![0]).toMatch(/#editar=/);

    const select = vi.spyOn(window.getSelection()!, 'selectAllChildren');
    await new Promise((r) => setTimeout(r, 1600));
    click($('linkAction'));
    await eventually(() => expect(select).toHaveBeenCalled());
  });

  it('en el celular envía el link con el menú de compartir', async () => {
    mount(html, ORIGIN);
    const matchMedia = window.matchMedia.bind(window);
    await unmount();
    await startWith();
    // El modo táctil se decide al cargar: lo simulamos recargando el script.
    window.matchMedia = ((q: string) => ({ ...matchMedia(q), matches: q.includes('hover: none') })) as typeof window.matchMedia;
    const share = vi.fn(async () => {});
    Object.assign(navigator, { share });
    vi.resetModules();
    document.documentElement.innerHTML = html.replace(/^<!DOCTYPE html>/i, '');
    await import('../src/scripts/app');
    click($('linkAction'));
    await eventually(() => expect(text('linkAction')).toBe('Enviar link'));
    click($('linkAction'));
    await eventually(() => expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringMatching(/\/ver#/) })));
  });

  it('si el link expiró, lo suelta; si no hay red, reintenta', async () => {
    await withLink();
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    click(faces()[0]);
    await eventually(() => expect(text('syncStatus')).toBe('Sin conexión. Reintentando…'));
    expect(text('announce')).toBe('Sin conexión. Reintentando…');

    globalThis.fetch = realFetch;
    const link = (await current())!.share!;
    await realFetch(`/api/share/${link.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${link.token}` } });
    click(faces()[1]);
    await eventually(() => expect(text('syncStatus')).toBe('El link expiró. Crea uno nuevo.'));
    expect($('linkReady').hidden).toBe(true);
  });

  it('avisa si no se pudo crear o desactivar', async () => {
    await startWith();
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('{"error":"Datos inválidos."}', { status: 400 })) as typeof fetch;
    click($('linkAction'));
    await eventually(() => expect(text('syncStatus')).toBe('Datos inválidos.'));
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    click($('linkAction'));
    await eventually(() => expect(text('syncStatus')).toMatch(/No se pudo crear/));

    globalThis.fetch = realFetch;
    click($('linkAction'));
    await eventually(() => expect(text('syncStatus')).toBe('En vivo'));
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 500 })) as typeof fetch;
    stubConfirm(true);
    click($('stopLink'));
    await eventually(() => expect(text('syncStatus')).toMatch(/No se pudo desactivar/));
  });

  it('una foto nueva deja el link anterior y pide uno nuevo', async () => {
    await withLink();
    await upload();
    await eventually(() => expect(text('syncStatus')).toBe('La foto nueva necesita un link nuevo.'));
    expect($('linkReady').hidden).toBe(true);
  });

  it('al abrir, trae los pagos del servidor; sin red avisa', async () => {
    const link = await (async () => {
      mount(html, ORIGIN);
      useApiFetch();
      const created = await createShare({ ...defaultState(), ...game({ title: 'Remoto' }) });
      await unmount();
      return created;
    })();
    const { pushShare } = await import('../src/scripts/share');
    mount(html, ORIGIN);
    useApiFetch();
    await pushShare(link, { ...defaultState(), ...game({ title: 'Cambiado en otro equipo' }) });
    await unmount();

    await startWith({ title: 'Local', share: link });
    await eventually(() => expect(text('gameTitle')).toBe('Cambiado en otro equipo'));

    await unmount();
    const offline = game({ share: { ...link } });
    mount(html, ORIGIN);
    await unmount();
    await start({ saved: [offline], current: offline.id });
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    window.dispatchEvent(new Event('hashchange'));
  });
});

describe('Mis partidos', () => {
  it('lista los partidos agrupados y abre uno', async () => {
    const debt = game({ title: 'Jueves', updatedAt: 2 });
    const paid = game({ title: 'Lunes', updatedAt: 1, faces: game().faces.map((f) => ({ ...f, paid: true })) });
    await start({ saved: [debt, paid], current: debt.id });
    await eventually(() => expect(text('historyCount')).toBe('2'));
    expect(text('historyCountLabel')).toBe(', 2 guardados');

    await openHistory();
    expect($<HTMLDialogElement>('history').open).toBe(true);
    expect([...document.querySelectorAll('.drawer-section')].map((h) => h.textContent)).toEqual(['Con deudas', 'Pagados']);
    expect(rowNamed('Jueves').classList.contains('is-current')).toBe(true);
    expect(text('historySummary')).toBe('Te deben S/ 90 en 1 partido.');

    click(rowNamed('Lunes').querySelector('[data-action=open]')!);
    await eventually(() => expect(text('gameTitle')).toBe('Lunes'));
    expect($<HTMLDialogElement>('history').open).toBe(false);
    expect(text('announce')).toBe('Abriste «Lunes».');
    expect(text('linkAction')).toBe('Próximo partido');
    expect($('progress').classList.contains('is-full')).toBe(true);

    // Abrir el que ya está abierto solo cierra el panel.
    await openHistory();
    click(rowNamed('Lunes').querySelector('[data-action=open]')!);
    await eventually(() => expect($<HTMLDialogElement>('history').open).toBe(false));
  });

  it('nuevo partido, repetir y "Próximo partido"', async () => {
    const paid = game({ title: 'Lunes', cost: 60, rounding: 1, faces: game().faces.map((f) => ({ ...f, paid: true })) });
    await start({ saved: [paid], current: paid.id });

    click($('linkAction')); // Próximo partido
    await eventually(() => expect($('stageWrap').hidden).toBe(true));
    expect(text('gameTitle')).toBe('Lunes');
    expect($<HTMLInputElement>('cost').value).toBe('60');
    expect($('gameForm').hidden).toBe(false);

    await openHistory();
    click($('newGame'));
    await eventually(() => expect(text('gameTitle')).toBe('Nuevo partido'));
    expect($<HTMLInputElement>('cost').value).toBe('');

    await openHistory();
    const menu = rowNamed('Lunes').querySelector('details')!;
    menu.open = true;
    click(menu.querySelector('[data-action=repeat]')!);
    await eventually(() => expect(text('gameTitle')).toBe('Lunes'));
    expect(menu.open).toBe(false);
  });

  it('borra partidos, el abierto incluido, y mueve el foco', async () => {
    const a = game({ title: 'A', updatedAt: 3 });
    const b = game({ title: 'B', updatedAt: 2 });
    await start({ saved: [a, b], current: a.id });
    await openHistory();

    stubConfirm(false);
    click(rowNamed('B').querySelector('[data-action=delete]')!);
    await new Promise((r) => setTimeout(r, 20));
    expect(rows()).toHaveLength(2);

    stubConfirm(true);
    click(rowNamed('A').querySelector('[data-action=delete]')!);
    await eventually(() => expect(rows()).toHaveLength(1));
    expect(text('historyStatus')).toBe('Borraste «A».');
    expect(text('gameTitle')).toBe('Nuevo partido');
    expect(document.activeElement?.closest('[data-id]')?.getAttribute('data-id')).toBe(b.id);
    expect(await games.loadGame(a.id)).toBeNull();

    click(rowNamed('B').querySelector('[data-action=delete]')!);
    await eventually(() => expect(rows()).toHaveLength(0));
    expect($('historyEmpty').hidden).toBe(false);
    expect(document.activeElement?.id).toBe('newGame');
  });

  it('se cierra con el botón, tocando el fondo y cierra los menús abiertos', async () => {
    const a = game({ title: 'A' });
    await start({ saved: [a], current: a.id });
    await openHistory();
    click($('openHistory')); // ya abierto: no hace nada
    const menu = rowNamed('A').querySelector('details')!;
    menu.open = true;
    click($('historySummary'));
    expect(menu.open).toBe(false);
    click($('history'));
    expect($<HTMLDialogElement>('history').open).toBe(false);
    await openHistory();
    click($('closeHistory'));
    expect($<HTMLDialogElement>('history').open).toBe(false);
  });

  it('mientras se detectan caras no se puede cambiar de partido', async () => {
    let finish: (boxes: typeof mocks.boxes) => void = () => {};
    mocks.detectFaces.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await start();
    await upload();
    await eventually(() => expect($<HTMLButtonElement>('openHistory').disabled).toBe(true));
    finish(mocks.boxes);
    await eventually(() => expect($<HTMLButtonElement>('openHistory').disabled).toBe(false));
  });
});

describe('link maestro', () => {
  async function remoteLink(title = 'Remoto') {
    mount(html, ORIGIN);
    useApiFetch();
    resetStore();
    const link = await createShare({ ...defaultState(), ...game({ title, cost: 60 }) });
    await unmount();
    return link;
  }

  it('en otro equipo lo agrega al historial y limpia la URL', async () => {
    const link = await remoteLink();
    await start({ hash: masterHash(link) });
    await eventually(() => expect(text('syncStatus')).toBe('En vivo'));
    expect($<HTMLInputElement>('title').value).toBe('Remoto');
    expect(faces()).toHaveLength(3);
    expect(location.hash).toBe('');
    await eventually(async () => expect((await games.findByShareId(link.id))?.title).toBe('Remoto'));
    expect((await current())?.thumb).toBe('data:image/jpeg;base64,THUMB');
  });

  it('si el equipo ya lo tenía, reusa ese partido; si ya está abierto, solo lo actualiza', async () => {
    const link = await remoteLink();
    const local = game({ title: 'Local', share: link, thumb: 'data:mine' });
    const other = game({ title: 'Otro' });
    await start({ saved: [local, other], current: other.id, hash: masterHash(link) });
    await eventually(() => expect(text('gameTitle')).toBe('Remoto'));
    expect(prefs().currentGameId).toBe(local.id);
    expect((await games.listGames()).length).toBe(2);

    location.hash = masterHash(link);
    window.dispatchEvent(new Event('hashchange'));
    await eventually(() => expect(location.hash).toBe(''));
    expect(text('syncStatus')).toBe('En vivo');
  });

  it('rechaza tokens inválidos, links inexistentes y avisa sin red', async () => {
    const link = await remoteLink();
    await start({ hash: masterHash({ ...link, token: 'x'.repeat(32) }) });
    await eventually(() => expect(text('syncStatus')).toBe('Ese link maestro no es válido.'));

    await unmount();
    await start({ hash: masterHash({ ...link, id: 'ZZZZZZZZZZ' }) });
    await eventually(() => expect(text('syncStatus')).toBe('Este link no existe o ya expiró.'));

    await unmount();
    await start();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    location.hash = masterHash({ ...link, id: 'YYYYYYYYYY' });
    window.dispatchEvent(new Event('hashchange'));
    await eventually(() => expect(text('syncStatus')).toBe('No se pudo abrir el link.'));
  });
});
