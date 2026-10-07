import { beforeEach, describe, expect, it } from 'vitest';
import { computeTotals, type Face } from '../src/scripts/state';
import { fitStageToPhoto, progressText, renderTotals, syncFaces, totalsEls } from '../src/scripts/view';

const face = (id: string, paid: boolean, emoji = '🐸'): Face => ({ id, x: 0.1, y: 0.2, w: 0.1, h: 0.15, emoji, paid });

beforeEach(() => {
  document.body.innerHTML = `
    <span id="peopleOut"></span><span id="shareOut"></span><span id="paidOut"></span>
    <div id="thermo"><div id="thermoFill"></div></div>
    <p id="pctOut"></p><span id="collectedOut"></span><p id="missingOut"></p>
    <div id="faces"></div>`;
});

describe('renderTotals', () => {
  it('pinta marcador, termómetro y mensaje', () => {
    const els = totalsEls();
    renderTotals(els, { faces: [face('a', true), face('b', false)], cost: 100, currency: 'S/', rounding: 0 });
    expect(els.peopleOut.textContent).toBe('2');
    expect(els.shareOut.textContent).toBe('S/ 50');
    expect(els.paidOut.textContent).toBe('1/2');
    expect(els.thermoFill.style.height).toBe('50%');
    expect(els.pctOut.textContent).toBe('50%');
    expect(els.missingOut.textContent).toBe('Falta 1 persona · S/ 50');
  });

  it('marca el termómetro lleno y respeta un mensaje propio', () => {
    const els = totalsEls();
    renderTotals(els, { faces: [face('a', true)], cost: 10, currency: 'S/', rounding: 0 });
    expect(els.thermo.classList.contains('is-full')).toBe(true);
    expect(els.missingOut.classList.contains('done')).toBe(true);
    renderTotals(els, { faces: [face('a', true)], cost: 10, currency: 'S/', rounding: 0 }, 'Otro mensaje');
    expect(els.missingOut.textContent).toBe('Otro mensaje');
    expect(els.missingOut.classList.contains('done')).toBe(false);
  });
});

describe('progressText', () => {
  const data = { cost: 100, currency: 'S/' };
  it('cubre cada caso', () => {
    expect(progressText(computeTotals({ faces: [], cost: 100, rounding: 0 }), data)).toMatch(/Todavía/);
    expect(progressText(computeTotals({ faces: [face('a', true)], cost: 100, rounding: 0 }), data)).toMatch(/pagada/);
    expect(progressText(computeTotals({ faces: [face('a', false), face('b', false)], cost: null, rounding: 0 }), { ...data, cost: null })).toBe(
      'Faltan 2 personas.',
    );
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
