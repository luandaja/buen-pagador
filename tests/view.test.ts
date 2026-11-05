import { beforeEach, describe, expect, it } from 'vitest';
import { es } from '../src/i18n/es';
import { computeTotals, money, type Face } from '../src/scripts/state';
import { fitStageToPhoto, gameMetaText, progressView, renderTotals, syncFaces, syncPeople, progressElements } from '../src/scripts/view';

const face = (id: string, paid: boolean, emoji = '🐸'): Face => ({ id, x: 0.1, y: 0.2, w: 0.1, h: 0.15, emoji, paid });

beforeEach(() => {
  document.body.innerHTML = `
    <section id="progress" data-perspective="owner">
      <p id="progressLabel"></p><span id="paidOut"></span><p id="heroOut"></p>
      <div id="thermo"></div>
      <p id="progressSums"><span id="shareLabel"></span><b id="shareOut"></b><b id="collectedOut"></b></p>
      <p id="missingOut"></p>
    </section>
    <div id="faces"></div>`;
});

const data = (faces: Face[], cost: number | null = 100) => ({ faces, cost, currency: 'S/', rounding: 0 });

describe('renderTotals', () => {
  it('renders what is missing, the bar and the details', () => {
    const elements = progressElements();
    renderTotals(elements, data([face('a', true), face('b', false)]));
    expect(elements.label.textContent).toBe(es.progress.ownerMissing);
    expect(elements.hero.textContent).toBe('S/\u00a050');
    expect(elements.paidOut.textContent).toBe('1/2');
    expect(elements.meter.style.getPropertyValue('--pct')).toBe('0.5');
    expect(elements.meter.style.getPropertyValue('--n')).toBe('2');
    expect(elements.meter.getAttribute('aria-valuetext')).toBe(es.progress.valueText(1, 2, 50));
    expect(elements.shareOut.textContent).toBe('S/\u00a050');
    expect(elements.collectedOut.textContent).toBe('S/\u00a050');
    expect(elements.missingOut.textContent).toBe('');
  });

  it('marks a settled game, shows a message and merges segments when there are many', () => {
    const elements = progressElements();
    renderTotals(elements, data([face('a', true)]), 'Another message');
    expect(elements.progress.classList.contains('is-full')).toBe(true);
    expect(elements.missingOut.textContent).toBe('Another message');
    const many = Array.from({ length: 41 }, (_, index) => face(String(index), false));
    renderTotals(elements, data(many));
    expect(elements.meter.classList.contains('is-dense')).toBe(true);
  });

  it('the public view does not address the organizer', () => {
    const elements = progressElements();
    elements.progress.dataset.perspective = 'public';
    renderTotals(elements, data([face('a', false)]));
    expect(elements.label.textContent).toBe(es.progress.publicShare);
  });

  it('the public view leads with the share and steps the missing total down', () => {
    const elements = progressElements();
    elements.progress.dataset.perspective = 'public';
    renderTotals(elements, data([face('a', true), face('b', false), face('c', false), face('d', false)]));
    expect(elements.hero.textContent).toBe('S/\u00a025');
    expect(elements.shareLabel.textContent).toBe(es.progress.publicMissing);
    expect(elements.shareOut.textContent).toBe('S/\u00a075');
    expect(elements.shareOut.classList.contains('is-accent')).toBe(false);
    expect(elements.sums.hidden).toBe(false);
  });

  it('with the total hidden the public view shows only the share', () => {
    const elements = progressElements();
    elements.progress.dataset.perspective = 'public';
    const faces = [face('a', true), face('b', false)];
    renderTotals(elements, { ...data(faces, null), quota: 30, hideTotal: true });
    expect(elements.label.textContent).toBe(es.progress.publicShare);
    expect(elements.hero.textContent).toBe('S/\u00a030');
    expect(elements.sums.hidden).toBe(true);
    renderTotals(elements, { ...data([face('a', true)], 60), hideTotal: true });
    expect(elements.hero.textContent).toBe('1/1');
  });

  it('the organizer still sees every total when hidden from the link', () => {
    const elements = progressElements();
    renderTotals(elements, { ...data([face('a', true), face('b', false)]), quota: 60, hideTotal: true });
    expect(elements.hero.textContent).toBe('S/\u00a060');
    expect(elements.collectedOut.textContent).toBe('S/\u00a060');
    expect(elements.sums.hidden).toBe(false);
  });
});

describe('progressView', () => {
  const view = (faces: Face[], cost: number | null = 100) =>
    progressView(computeTotals({ faces, cost, rounding: 0 }), { cost, currency: 'S/' }, true);

  it('covers every case', () => {
    expect(view([])).toEqual({ label: es.progress.noPlayers, hero: '—', full: false });
    expect(view([face('a', true)])).toEqual({ label: es.progress.settled, hero: money(100, 'S/'), full: true });
    expect(view([face('a', true)], null)).toMatchObject({ hero: '1/1', full: true });
    expect(view([face('a', false), face('b', false)], null)).toEqual({ label: es.progress.pendingLabel, hero: es.progress.pendingHero(2, 2), full: false });
  });
});

describe('gameMetaText', () => {
  it('summarizes cost and players', () => {
    expect(gameMetaText(data([face('a', false), face('b', false)]))).toBe([es.game.metaCost(money(100, 'S/')), es.game.metaPlayers(2)].join(' · '));
    expect(gameMetaText(data([face('a', false)], null))).toBe(es.game.metaPlayers(1));
    expect(gameMetaText(data([], null))).toBe(es.game.metaEmpty);
    expect(gameMetaText({ ...data([face('a', false)]), quota: 12 })).toBe(
      [es.game.metaCost(money(100, 'S/')), es.game.metaQuota(money(12, 'S/')), es.game.metaPlayers(1)].join(' · '),
    );
  });
});

describe('syncFaces', () => {
  it('creates, updates and removes markers without recreating them', () => {
    const container = document.getElementById('faces')!;
    const markers = new Map<string, HTMLElement>();
    const label = (face: Face, index: number) => `${index}:${face.paid}`;

    syncFaces(container, markers, [face('a', false), face('b', true)], { interactive: true, label });
    const firstMarker = markers.get('a')!;
    expect(firstMarker.tagName).toBe('BUTTON');
    expect(firstMarker.style.left).toBe('10%');
    expect(firstMarker.getAttribute('aria-pressed')).toBe('false');
    expect(markers.get('b')!.classList.contains('is-settled')).toBe(true);

    syncFaces(container, markers, [face('a', true, '🦊')], { interactive: true, label });
    expect(markers.get('a')).toBe(firstMarker);
    expect(firstMarker.classList.contains('is-paid')).toBe(true);
    expect(firstMarker.querySelector('.face-emoji')!.textContent).toBe('🦊');
    expect(markers.has('b')).toBe(false);
    expect(container.children).toHaveLength(1);
  });

  it('uses non-interactive elements in read-only mode', () => {
    const markers = new Map<string, HTMLElement>();
    syncFaces(document.getElementById('faces')!, markers, [face('a', false)], { interactive: false, label: () => 'x' });
    const marker = markers.get('a')!;
    expect(marker.tagName).toBe('SPAN');
    expect(marker.getAttribute('role')).toBe('img');
    expect(marker.hasAttribute('aria-pressed')).toBe(false);
  });

  it('leaves faces unplaced in a grid, for games without photo, with their names', () => {
    const markers = new Map<string, HTMLElement>();
    const container = document.getElementById('faces')!;
    syncFaces(container, markers, [face('a', false)], { interactive: true, label: () => 'x' });
    syncFaces(container, markers, [{ ...face('a', false), name: 'Juan' }], { interactive: true, grid: true, label: () => 'x' });
    expect(markers.get('a')!.getAttribute('style')).toBe('--i: 0');
    expect(container.classList.contains('is-ring')).toBe(true);
    expect(container.dataset.count).toBe('0/1');
    expect(markers.get('a')!.querySelector('.face-name')!.textContent).toBe('Juan');
    expect(markers.get('a')!.querySelector('.face-initial')!.textContent).toBe('J');
  });
});

describe('syncPeople', () => {
  it('keeps one row per person and never overwrites the name being typed', () => {
    const list = document.createElement('ol');
    document.body.append(list);
    const rows = new Map<string, HTMLElement>();
    syncPeople(list, rows, [{ ...face('a', true), name: 'Juan' }]);
    const field = rows.get('a')!.querySelector('input')!;
    expect(field.value).toBe('Juan');
    expect(rows.get('a')!.classList.contains('is-paid')).toBe(true);
    expect(rows.get('a')!.querySelector('button')!.disabled).toBe(true);

    field.focus();
    field.value = 'Juan ';
    syncPeople(list, rows, [{ ...face('a', true), name: 'Juan' }, face('b', false)]);
    expect(field.value).toBe('Juan ');
    expect(rows.get('b')!.querySelector('input')!.placeholder).toBe(es.faces.person(2));
    expect(rows.get('a')!.querySelector('button')!.disabled).toBe(false);
    expect(list.children).toHaveLength(2);
  });
});

describe('fitStageToPhoto', () => {
  it('passes the photo aspect ratio to the stage', () => {
    const photo = document.createElement('img');
    const area = document.createElement('div');
    fitStageToPhoto(photo, area);
    Object.defineProperties(photo, { naturalWidth: { value: 1600 }, naturalHeight: { value: 900 } });
    photo.dispatchEvent(new Event('load'));
    expect(area.style.getPropertyValue('--ar')).toBe('1.7778');
  });

  it('ignores photos without a size', () => {
    const photo = document.createElement('img');
    const area = document.createElement('div');
    fitStageToPhoto(photo, area);
    photo.dispatchEvent(new Event('load'));
    expect(area.style.getPropertyValue('--ar')).toBe('');
  });
});
