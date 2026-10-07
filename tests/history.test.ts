import { beforeEach, describe, expect, it } from 'vitest';
import type { GameMeta } from '../src/scripts/games';
import { debtSummary, formatDate, groupGames, renderHistory, summarize } from '../src/scripts/history';
import { newGame, type Face } from '../src/scripts/state';

const face = (paid: boolean): Face => ({ id: Math.random().toString(36), x: 0, y: 0, w: 0.1, h: 0.1, emoji: '🐸', paid });

function game(overrides: Partial<GameMeta> = {}): GameMeta {
  const { image: _, ...meta } = newGame();
  return { ...meta, createdAt: new Date(2026, 9, 1).getTime(), ...overrides };
}

const debtor = game({ id: 'deb', title: 'Jueves', cost: 100, faces: [face(true), face(false)], share: { id: 'x', key: 'k', token: 't' } });
const paid = game({ id: 'pag', title: 'Lunes', cost: 60, faces: [face(true), face(true)], thumb: 'data:thumb' });
const empty = game({ id: 'vac', title: '  ', cost: null, faces: [] });
const noCost = game({ id: 'sin', title: 'Sin costo', faces: [face(false), face(false)] });

describe('resúmenes', () => {
  it('describe cada partido y su estado', () => {
    expect(summarize(debtor)).toMatchObject({
      title: 'Jueves',
      date: expect.stringMatching(/^Creado /),
      detail: '1/2 pagaron',
      amount: 'S/ 50',
      badge: { tone: 'debt' },
      debt: 50,
      linked: true,
    });
    expect(summarize(paid)).toMatchObject({ amount: 'Pagado', badge: { tone: 'paid' } });
    expect(summarize(empty)).toMatchObject({ title: 'Partido sin nombre', amount: 'Sin jugadores', badge: { tone: 'empty' } });
    expect(summarize(noCost).badge.text).toBe('Faltan 2');
  });

  it('formatea la fecha corta en español', () => {
    expect(formatDate(new Date(2026, 9, 1).getTime())).toMatch(/1 oct/);
  });

  it('agrupa primero los que tienen deudas', () => {
    const { debts, settled } = groupGames([paid, debtor, empty]);
    expect(debts.map((s) => s.id)).toEqual(['deb']);
    expect(settled.map((s) => s.id)).toEqual(['pag', 'vac']);
  });

  it('suma lo que te deben por moneda', () => {
    const usd = game({ id: 'usd', currency: '$', cost: 20, faces: [face(false)] });
    expect(debtSummary([summarize(paid)])).toBe('Nadie te debe nada.');
    expect(debtSummary([summarize(debtor)])).toBe('Te deben S/ 50 en 1 partido.');
    expect(debtSummary([summarize(debtor), summarize(debtor), summarize(usd)])).toBe('Te deben S/ 100 y $ 20 en 3 partidos.');
  });
});

describe('renderHistory', () => {
  let els: { list: HTMLElement; summary: HTMLElement; empty: HTMLElement };

  beforeEach(() => {
    document.body.innerHTML = '<p id="s"></p><div id="l"></div><p id="e"></p>';
    els = { list: document.getElementById('l')!, summary: document.getElementById('s')!, empty: document.getElementById('e')! };
  });

  it('pinta las secciones, el actual y las acciones', () => {
    renderHistory(els, [debtor, paid], 'pag');
    const sections = [...els.list.querySelectorAll('h3')].map((h) => h.textContent);
    expect(sections).toEqual(['Con deudas', 'Pagados']);
    const rows = els.list.querySelectorAll('li');
    expect(rows[0].dataset.id).toBe('deb');
    expect(rows[0].querySelector('.tag-live')).not.toBeNull();
    expect(rows[0].querySelector('.thumb-empty')).not.toBeNull();
    expect(rows[1].classList.contains('is-current')).toBe(true);
    expect(rows[1].querySelector('.game-open')?.getAttribute('aria-current')).toBe('true');
    expect(rows[0].querySelector('.row-amount')?.textContent).toBe('S/ 50');
    expect(rows[1].querySelector('img')?.getAttribute('src')).toBe('data:thumb');
    expect([...rows[0].querySelectorAll('[data-action]')].map((b) => b.getAttribute('data-action'))).toEqual(['open', 'repeat', 'delete']);
    expect(rows[0].querySelector('summary')?.getAttribute('aria-label')).toBe('Opciones de Jueves');
    expect(rows[0].querySelector('[data-action=delete]')?.textContent).toBe('Borrar de este dispositivo');
    expect(els.summary.textContent).toMatch(/Te deben/);
    expect(els.empty.hidden).toBe(true);
  });

  it('sin partidos muestra el estado vacío', () => {
    renderHistory(els, [], null);
    expect(els.list.children).toHaveLength(0);
    expect(els.summary.textContent).toBe('');
    expect(els.empty.hidden).toBe(false);
  });

  it('escapa los títulos (no inyecta HTML)', () => {
    renderHistory(els, [game({ id: 'x', title: '<img src=x onerror=alert(1)>', faces: [face(false)] })], null);
    expect(els.list.querySelector('strong')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(els.list.querySelector('strong img')).toBeNull();
  });
});
