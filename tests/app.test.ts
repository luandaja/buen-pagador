// @vitest-environment node
// Integración del editor: HTML real de la página + API real en proceso.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore } from '../src/lib/store';
import Index from '../src/pages/index.astro';
import { createShare, loadShare } from '../src/scripts/share';
import { defaultState, DEBTOR_EMOJIS, type State } from '../src/scripts/state';
import { useApiFetch } from './helpers/api';
import { $, click, eventually, input, mount, renderPage, unmount } from './helpers/dom';

const mocks = vi.hoisted(() => ({
  boxes: [] as { x: number; y: number; w: number; h: number; score: number }[],
  detectFaces: vi.fn(),
  renderCard: vi.fn(),
}));

vi.mock('../src/scripts/detect', () => ({ detectFaces: mocks.detectFaces, warmUp: vi.fn() }));
vi.mock('../src/scripts/export', () => ({ renderCard: mocks.renderCard }));
vi.mock('../src/scripts/image', () => ({
  fileToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
  canvasToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
  shareImageBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  bytesToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,BBBB'),
}));

const ORIGIN = 'http://localhost:4321';
let html = '';

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
});

afterEach(async () => {
  vi.useRealTimers();
  await unmount();
});

/** Monta la página, con estado guardado opcional, y arranca el script del editor. */
async function start(saved?: Partial<State>, hash = '') {
  mount(html, `${ORIGIN}/${hash}`);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useApiFetch();
  if (saved) localStorage.setItem('buen-pagador:v1', JSON.stringify({ ...defaultState(), ...saved }));
  const photo = $<HTMLImageElement>('photo');
  Object.defineProperties(photo, {
    naturalWidth: { value: 800 },
    naturalHeight: { value: 600 },
    decode: { value: async () => {} },
  });
  vi.spyOn($('faces'), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600 } as DOMRect);
  HTMLAnchorElement.prototype.click = vi.fn();
  vi.resetModules();
  await import('../src/scripts/app');
}

async function upload(type = 'image/jpeg') {
  const file = new File(['x'], 'foto.jpg', { type });
  const fileInput = $<HTMLInputElement>('file');
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
  fileInput.dispatchEvent(new Event('change'));
}

/** happy-dom no implementa confirm(). */
function stubConfirm() {
  const fn = vi.fn(() => true);
  globalThis.confirm = fn;
  return fn;
}

const masterHash = (link: { id: string; key: string; token: string }) => `#editar=${link.id}.${link.key}.${link.token}`;

const faces = () => [...document.querySelectorAll<HTMLButtonElement>('.face')];
const saved = (): State => JSON.parse(localStorage.getItem('buen-pagador:v1')!);
const text = (id: string) => $(id).textContent;

const withPhoto = (extra: Partial<State> = {}): Partial<State> => ({
  image: 'data:image/jpeg;base64,AAAA',
  cost: 90,
  faces: ['a', 'b', 'c'].map((id, i) => ({ id, x: 0.1 * i, y: 0.1, w: 0.1, h: 0.1, emoji: DEBTOR_EMOJIS[i], paid: false })),
  ...extra,
});

describe('foto y caras', () => {
  it('empieza vacío, detecta caras y calcula la cuota', async () => {
    await start();
    expect($('dropzone').hidden).toBe(false);
    expect($<HTMLButtonElement>('linkAction').disabled).toBe(true);
    expect(text('missingOut')).toBe('Sube una foto para empezar.');

    await upload();
    await eventually(() => expect(faces()).toHaveLength(3));
    expect($('stageWrap').hidden).toBe(false);
    expect(text('missingOut')).toMatch(/costo/);

    input($<HTMLInputElement>('cost'), '120');
    expect(text('shareOut')).toBe('S/ 40');
    input($<HTMLInputElement>('cost'), 'abc');
    expect(text('shareOut')).toBe('—');
  });

  it('marca pagos, agrega y quita caras', async () => {
    await start(withPhoto());
    click(faces()[0]);
    expect(text('paidOut')).toBe('1/3');
    expect(faces()[0].classList.contains('is-paid')).toBe(true);

    click($('faces')); // en modo pagos, tocar el vacío no hace nada
    expect(faces()).toHaveLength(3);

    click(document.querySelector('[data-mode="edit"]')!);
    expect($('stage').classList.contains('is-edit')).toBe(true);
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

  it('"Cambiar foto" abre el selector', async () => {
    await start(withPhoto());
    const open = vi.spyOn($<HTMLInputElement>('file'), 'click');
    click($('newPhoto'));
    expect(open).toHaveBeenCalled();
  });
});

describe('emojis', () => {
  it('clic derecho bloquea el emoji, se puede restaurar', async () => {
    await start(withPhoto());
    const before = faces()[0].querySelector('.face-emoji')!.textContent;
    faces()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(text('hint')).toBe(`Listo, ${before} no vuelve a salir.`);
    expect(text('blockedList')).toBe(before);
    expect($('blockedBar').hidden).toBe(false);

    // Un segundo evento inmediato (Android) no bloquea otra vez.
    faces()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(saved().blocked ?? []).toHaveLength(0); // aún no se guardó (debounce)

    click($('unblock'));
    expect($('blockedBar').hidden).toBe(true);
  });

  it('avisa cuando quedan muy pocos emojis', async () => {
    const blocked = DEBTOR_EMOJIS.slice(3, 20);
    await start(withPhoto({ blocked }));
    faces()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(text('hint')).toMatch(/muy pocos emojis/);
  });

  it('mantener presionado bloquea y no marca como pagado', async () => {
    await start(withPhoto());
    const target = faces()[1];
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    await eventually(() => expect(text('hint')).toMatch(/no vuelve a salir/), 2000);
    click(target);
    expect(text('paidOut')).toBe('0/3');

    // Un toque corto se cancela al levantar el dedo o moverlo.
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch' }));
    target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }));
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
  });

  it('ver caras y sortear otros emojis', async () => {
    await start(withPhoto());
    click($('peek'));
    expect($('stage').classList.contains('is-peek')).toBe(true);
    expect(text('peek')).toMatch(/Tapar/);
    click($('peek'));
    expect($('stage').classList.contains('is-peek')).toBe(false);
    click($('reroll'));
    expect(faces()).toHaveLength(3);
  });
});

describe('formulario y guardado', () => {
  it('guarda los cambios y al cerrar la página', async () => {
    await start(withPhoto({ title: 'Antes' }));
    expect($<HTMLInputElement>('title').value).toBe('Antes');
    input($<HTMLInputElement>('title'), 'Jueves');
    input($<HTMLInputElement>('currency'), ' $ ');
    input($<HTMLSelectElement>('rounding'), '1', 'change');
    const check = $<HTMLInputElement>('includePhoto');
    check.checked = false;
    check.dispatchEvent(new Event('change'));
    window.dispatchEvent(new Event('pagehide'));
    expect(saved()).toMatchObject({ title: 'Jueves', currency: '$', rounding: 1, includePhoto: false });
  });
});

describe('exportar imagen', () => {
  it('descarga la imagen con el nombre del partido', async () => {
    await start(withPhoto({ title: 'Jueves 9 pm' }));
    click($('download'));
    await eventually(() => expect(text('exportMsg')).toBe('Imagen descargada: buen-pagador-jueves-9-pm.png'));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it('avisa si no se pudo generar', async () => {
    await start(withPhoto());
    mocks.renderCard.mockRejectedValueOnce(new Error('canvas'));
    click($('download'));
    await eventually(() => expect(text('exportMsg')).toMatch(/No se pudo generar/));
  });

  it('comparte la imagen si el navegador lo permite', async () => {
    mount(html, ORIGIN);
    const share = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AbortError' })).mockRejectedValueOnce(new Error('falló'));
    Object.assign(navigator, { canShare: () => true, share });
    await unmount();
    await start(withPhoto());
    Object.assign(navigator, { canShare: () => true, share });
    expect($('share').hidden).toBe(true); // el sondeo se hizo antes de stubear
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
  it('crea el link, sincroniza pagos y lo borra', async () => {
    await start(withPhoto());
    const action = $<HTMLButtonElement>('linkAction');
    expect(action.disabled).toBe(false);
    click(action);
    await eventually(() => expect(text('syncStatus')).toBe('Al día ✓'));
    const publicUrl = $<HTMLInputElement>('publicUrl').value;
    expect(publicUrl).toMatch(/\/ver#[A-Za-z0-9]{10}\.[\w-]{43}$/);
    expect(action.textContent).toMatch(/Copiar link/);

    click(faces()[0]);
    expect(text('syncStatus')).toBe('Guardando…');
    await eventually(() => expect(text('syncStatus')).toBe('Al día ✓'));
    const [id, key] = new URL(publicUrl).hash.slice(1).split('.');
    expect((await loadShare({ id, key }, false)).state.faces[0].paid).toBe(true);

    stubConfirm().mockReturnValueOnce(false).mockReturnValueOnce(true);
    click($('stopLink'));
    expect($('linkReady').hidden).toBe(false);
    click($('stopLink'));
    await eventually(() => expect(text('syncStatus')).toBe('Link borrado.'));
    await expect(loadShare({ id, key }, false)).rejects.toMatchObject({ status: 404 });
  });

  it('copia los links al portapapeles', async () => {
    await start(withPhoto());
    click($('linkAction'));
    await eventually(() => expect($('linkReady').hidden).toBe(false));
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('sin permiso'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    click($('linkAction'));
    await eventually(() => expect(text('linkAction')).toBe('Copiado ✓'));
    const copyMaster = document.querySelector<HTMLButtonElement>('[data-copy="masterUrl"]')!;
    click(copyMaster);
    await eventually(() => expect(copyMaster.textContent).toBe('Copiado ✓'));
    expect(writeText).toHaveBeenLastCalledWith($<HTMLInputElement>('masterUrl').value);
    const select = vi.spyOn($<HTMLInputElement>('publicUrl'), 'select');
    click(document.querySelector('[data-copy="publicUrl"]')!);
    await eventually(() => expect(select).toHaveBeenCalled());
  });

  it('si el link expiró, lo suelta; si no hay red, reintenta', async () => {
    await start(withPhoto());
    click($('linkAction'));
    await eventually(() => expect(text('syncStatus')).toBe('Al día ✓'));

    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    click(faces()[0]);
    await eventually(() => expect(text('syncStatus')).toBe('Sin conexión. Reintentando…'));

    globalThis.fetch = realFetch;
    const link = saved().share!;
    await realFetch(`/api/share/${link.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${link.token}` } });
    click(faces()[1]);
    await eventually(() => expect(text('syncStatus')).toBe('El link expiró. Crea uno nuevo.'));
    expect($('linkReady').hidden).toBe(true);
  });

  it('avisa si no se pudo crear o borrar', async () => {
    await start(withPhoto());
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
    await eventually(() => expect(text('syncStatus')).toBe('Al día ✓'));
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 500 })) as typeof fetch;
    stubConfirm().mockReturnValue(true);
    click($('stopLink'));
    await eventually(() => expect(text('syncStatus')).toMatch(/No se pudo borrar/));
  });

  it('una foto nueva deja el link anterior y pide uno nuevo', async () => {
    await start(withPhoto());
    click($('linkAction'));
    await eventually(() => expect(text('syncStatus')).toBe('Al día ✓'));
    await upload();
    await eventually(() => expect(text('syncStatus')).toBe('La foto nueva necesita un link nuevo.'));
    expect($('linkReady').hidden).toBe(true);
  });
});

describe('link maestro', () => {
  async function existingLink() {
    mount(html, ORIGIN);
    useApiFetch();
    resetStore();
    const link = await createShare({ ...defaultState(), ...withPhoto({ title: 'Remoto', cost: 60 }) } as State);
    await unmount();
    return link;
  }

  it('carga el partido para editarlo y limpia la URL', async () => {
    const link = await existingLink();
    await start(undefined, masterHash(link));
    await eventually(() => expect(text('syncStatus')).toBe('Al día ✓'));
    expect($<HTMLInputElement>('title').value).toBe('Remoto');
    expect(faces()).toHaveLength(3);
    expect(location.hash).toBe('');
  });

  it('si ya está abierto no hace nada; si hay otra foto pregunta', async () => {
    const link = await existingLink();
    await start(withPhoto({ share: link }), masterHash(link));
    expect(text('syncStatus')).toBe('Al día ✓');

    await unmount();
    const other = await existingLink();
    mount(html, ORIGIN);
    await unmount();
    await start(withPhoto());
    stubConfirm().mockReturnValueOnce(false);
    location.hash = masterHash(other);
    window.dispatchEvent(new Event('hashchange'));
    await new Promise((r) => setTimeout(r, 50));
    expect(saved().share ?? null).toBeNull();
  });

  it('rechaza tokens inválidos y links inexistentes', async () => {
    const link = await existingLink();
    await start(undefined, masterHash({ ...link, token: 'x'.repeat(32) }));
    await eventually(() => expect(text('syncStatus')).toBe('Ese link maestro no es válido.'));

    await unmount();
    await start(undefined, masterHash({ ...link, id: 'ZZZZZZZZZZ' }));
    await eventually(() => expect(text('syncStatus')).toBe('Este link no existe o ya expiró.'));

    await unmount();
    await start(undefined, masterHash(link));
    await eventually(() => expect(text('syncStatus')).toBe('Al día ✓'));
    stubConfirm();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    location.hash = masterHash({ ...link, id: 'YYYYYYYYYY' });
    window.dispatchEvent(new Event('hashchange'));
    await eventually(() => expect(text('syncStatus')).toBe('No se pudo abrir el link.'));
  });
});
