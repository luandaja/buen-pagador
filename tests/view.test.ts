import { beforeEach, describe, expect, it } from 'vitest';
import { computeTotals, type Face } from '../src/scripts/state';
import { fitStageToPhoto, gameMetaText, progressView, renderTotals, syncFaces, totalsEls } from '../src/scripts/view';

const face = (id: string, paid: boolean, emoji = '🐸'): Face => ({ id, x: 0.1, y: 0.2, w: 0.1, h: 0.15, emoji, paid });

beforeEach(() => {
  document.body.innerHTML = `
    <section id="progress" data-perspective="owner">
      <p id="progressLabel"></p><span id="paidOut"></span><p id="heroOut"></p>
      <div id="thermo"></div>
      <b id="shareOut"></b><b id="collectedOut"></b>
      <p id="missingOut"></p>
    </section>
    <div id="faces"></div>`;
});

const data = (faces: Face[], cost: number | null = 100) => ({ faces, cost, currency: 'S/', rounding: 0 });

describe('renderTotals', () => {
  it('pinta cuánto falta, la barra y el detalle', () => {
    const els = totalsEls();
    renderTotals(els, data([face('a', true), face('b', false)]));
    expect(els.label.textContent).toBe('Te faltan');
    expect(els.hero.textContent).toBe('S/\u00a050');
    expect(els.paidOut.textContent).toBe('1/2');
    expect(els.thermo.style.getPropertyValue('--pct')).toBe('0.5');
    expect(els.thermo.style.getPropertyValue('--n')).toBe('2');
    expect(els.thermo.getAttribute('aria-valuetext')).toBe('1 de 2 pagaron (50 %)');
    expect(els.shareOut.textContent).toBe('S/\u00a050');
    expect(els.collectedOut.textContent).toBe('S/\u00a050');
    expect(els.missingOut.textContent).toBe('');
  });

  it('marca el partido pagado, agrega un mensaje y junta los segmentos si son muchos', () => {
    const els = totalsEls();
    renderTotals(els, data([face('a', true)]), 'Otro mensaje');
    expect(els.progress.classList.contains('is-full')).toBe(true);
    expect(els.missingOut.textContent).toBe('Otro mensaje');
    const many = Array.from({ length: 41 }, (_, i) => face(String(i), false));
    renderTotals(els, data(many));
    expect(els.thermo.classList.contains('is-dense')).toBe(true);
  });

  it('en la vista pública no le habla al organizador', () => {
    const els = totalsEls();
    els.progress.dataset.perspective = 'public';
    renderTotals(els, data([face('a', false)]));
    expect(els.label.textContent).toBe('Faltan');
  });
});

describe('progressView', () => {
  const view = (faces: Face[], cost: number | null = 100) =>
    progressView(computeTotals({ faces, cost, rounding: 0 }), { cost, currency: 'S/' }, true);

  it('cubre cada caso', () => {
    expect(view([])).toEqual({ label: 'Pagaron', hero: '—', full: false });
    expect(view([face('a', true)])).toEqual({ label: '¡Cancha pagada!', hero: 'S/\u00a0100', full: true });
    expect(view([face('a', true)], null)).toMatchObject({ hero: '1/1', full: true });
    expect(view([face('a', false), face('b', false)], null)).toEqual({ label: 'Faltan pagar', hero: '2 de 2', full: false });
  });
});

describe('gameMetaText', () => {
  it('resume costo, jugadores y cuota', () => {
    expect(gameMetaText(data([face('a', false), face('b', false)]))).toBe('Cancha S/ 100 · 2 jugadores');
    expect(gameMetaText(data([face('a', false)], null))).toBe('1 jugador');
    expect(gameMetaText(data([], null))).toBe('Ponle nombre y costo.');
  });
});

describe('syncFaces', () => {
  it('crea, actualiza y elimina marcadores sin recrearlos', () => {
    const container = document.getElementById('faces')!;
    const map = new Map<string, HTMLElement>();
    const label = (f: Face, i: number) => `${i}:${f.paid}`;

    syncFaces(container, map, [face('a', false), face('b', true)], { interactive: true, label });
    const a = map.get('a')!;
    expect(a.tagName).toBe('BUTTON');
    expect(a.style.left).toBe('10%');
    expect(a.getAttribute('aria-pressed')).toBe('false');
    expect(map.get('b')!.classList.contains('is-settled')).toBe(true);

    syncFaces(container, map, [face('a', true, '🦊')], { interactive: true, label });
    expect(map.get('a')).toBe(a);
    expect(a.classList.contains('is-paid')).toBe(true);
    expect(a.querySelector('.face-emoji')!.textContent).toBe('🦊');
    expect(map.has('b')).toBe(false);
    expect(container.children).toHaveLength(1);
  });

  it('en solo lectura usa elementos no interactivos', () => {
    const map = new Map<string, HTMLElement>();
    syncFaces(document.getElementById('faces')!, map, [face('a', false)], { interactive: false, label: () => 'x' });
    const el = map.get('a')!;
    expect(el.tagName).toBe('SPAN');
    expect(el.getAttribute('role')).toBe('img');
    expect(el.hasAttribute('aria-pressed')).toBe(false);
  });
});

describe('fitStageToPhoto', () => {
  it('pasa la proporción de la foto al escenario', () => {
    const photo = document.createElement('img');
    const area = document.createElement('div');
    fitStageToPhoto(photo, area);
    Object.defineProperties(photo, { naturalWidth: { value: 1600 }, naturalHeight: { value: 900 } });
    photo.dispatchEvent(new Event('load'));
    expect(area.style.getPropertyValue('--ar')).toBe('1.7778');
  });

  it('ignora fotos sin tamaño', () => {
    const photo = document.createElement('img');
    const area = document.createElement('div');
    fitStageToPhoto(photo, area);
    photo.dispatchEvent(new Event('load'));
    expect(area.style.getPropertyValue('--ar')).toBe('');
  });
});
