import { beforeEach, describe, expect, it } from 'vitest';
import type { GameMeta } from '../src/scripts/games';
import { debtSummary, formatDate, groupGames, renderHistory, summarize } from '../src/scripts/history';
import { es } from '../src/i18n/es';
import { money, newGame, type Face } from '../src/scripts/state';

const face = (paid: boolean): Face => ({ id: Math.random().toString(36), x: 0, y: 0, w: 0.1, h: 0.1, emoji: '🐸', paid });

function game(overrides: Partial<GameMeta> = {}): GameMeta {
  const { image: _, ...meta } = newGame();
  return { ...meta, createdAt: new Date(2026, 9, 1).getTime(), ...overrides };
}

const debtor = game({ id: 'owing', title: 'Thursday', cost: 100, faces: [face(true), face(false)], share: { id: 'x', key: 'k', token: 't' } });
const paid = game({ id: 'settled', title: 'Monday', cost: 60, faces: [face(true), face(true)], thumb: 'data:thumb' });
const empty = game({ id: 'empty', title: '  ', cost: null, faces: [] });
const noCost = game({ id: 'no-cost', title: 'No cost', faces: [face(false), face(false)] });

describe('summaries', () => {
  it('describes each game and its status', () => {
    expect(summarize(debtor)).toMatchObject({
      title: 'Thursday',
      date: es.history.created(formatDate(debtor.createdAt)),
      detail: es.history.paidOf(1, 2),
      amount: money(50, 'S/'),
      badge: { tone: 'debt' },
      debt: 50,
      linked: true,
    });
    expect(summarize(paid)).toMatchObject({ amount: es.history.paid, badge: { tone: 'paid' } });
    expect(summarize(empty)).toMatchObject({ title: es.game.unnamed, amount: es.history.noPlayers, badge: { tone: 'empty' } });
    expect(summarize(noCost).badge.text).toBe(es.history.pending(2));
  });

  it('formats a short localized date', () => {
    const date = formatDate(new Date(2026, 9, 1).getTime());
    expect(date).toMatch(/\b1\b/);
    expect(date).not.toContain('.');
  });

  it('groups games with debts first', () => {
    const { debts, settled } = groupGames([paid, debtor, empty]);
    expect(debts.map((summary) => summary.id)).toEqual(['owing']);
    expect(settled.map((summary) => summary.id)).toEqual(['settled', 'empty']);
  });

  it('adds up what you are owed per currency', () => {
    const usd = game({ id: 'usd', currency: '$', cost: 20, faces: [face(false)] });
    expect(debtSummary([summarize(paid)])).toBe(es.history.nobodyOwes);
    expect(debtSummary([summarize(debtor)])).toBe(es.history.owed(money(50, 'S/'), 1));
    expect(debtSummary([summarize(debtor), summarize(debtor), summarize(usd)])).toBe(es.history.owed([money(100, 'S/'), money(20, '$')].join(es.history.and), 3));
  });
});

describe('renderHistory', () => {
  let elements: { list: HTMLElement; summary: HTMLElement; empty: HTMLElement };

  beforeEach(() => {
    document.body.innerHTML = '<p id="s"></p><div id="l"></div><p id="e"></p>';
    elements = { list: document.getElementById('l')!, summary: document.getElementById('s')!, empty: document.getElementById('e')! };
  });

  it('renders sections, the current game and actions', () => {
    renderHistory(elements, [debtor, paid], 'settled');
    const sections = [...elements.list.querySelectorAll('h3')].map((heading) => heading.textContent);
    expect(sections).toEqual([es.history.debts, es.history.settled]);
    const rows = elements.list.querySelectorAll('li');
    expect(rows[0].dataset.id).toBe('owing');
    expect(rows[0].querySelector('.tag-live')).not.toBeNull();
    expect(rows[0].querySelector('.thumb-empty')).not.toBeNull();
    expect(rows[1].classList.contains('is-current')).toBe(true);
    expect(rows[1].querySelector('.game-open')?.getAttribute('aria-current')).toBe('true');
    expect(rows[0].querySelector('.row-amount')?.textContent).toBe(money(50, 'S/'));
    expect(rows[1].querySelector('img')?.getAttribute('src')).toBe('data:thumb');
    expect([...rows[0].querySelectorAll('[data-action]')].map((button) => button.getAttribute('data-action'))).toEqual(['open', 'repeat', 'delete']);
    expect(rows[0].querySelector('summary')?.getAttribute('aria-label')).toBe(es.history.options('Thursday'));
    expect(rows[0].querySelector('[data-action=delete]')?.textContent).toBe(es.history.remove);
    expect(elements.summary.textContent).toBe(es.history.owed(money(50, 'S/'), 1));
    expect(elements.empty.hidden).toBe(true);
  });

  it('shows the empty state without games', () => {
    renderHistory(elements, [], null);
    expect(elements.list.children).toHaveLength(0);
    expect(elements.summary.textContent).toBe('');
    expect(elements.empty.hidden).toBe(false);
  });

  it('escapes titles instead of injecting HTML', () => {
    renderHistory(elements, [game({ id: 'x', title: '<img src=x onerror=alert(1)>', faces: [face(false)] })], null);
    expect(elements.list.querySelector('strong')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(elements.list.querySelector('strong img')).toBeNull();
  });
});
