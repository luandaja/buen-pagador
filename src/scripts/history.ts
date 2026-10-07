import { es, locale } from '../i18n/es';
import type { GameMeta } from './games';
import { computeTotals, money } from './state';

export interface GameSummary {
  id: string;
  title: string;
  date: string;
  detail: string;
  amount: string;
  badge: { text: string; tone: 'debt' | 'paid' | 'empty' };
  debt: number;
  currency: string;
  linked: boolean;
  thumb: string | null;
}

const dateFormat = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });

export const formatDate = (timestamp: number) => dateFormat.format(new Date(timestamp)).replace(/\./g, '');

function badgeFor(people: number, pending: number, missing: number | null, currency: string): GameSummary['badge'] {
  if (people === 0) return { text: es.history.noPlayers, tone: 'empty' };
  if (pending === 0) return { text: es.history.paid, tone: 'paid' };
  return { text: missing == null ? es.history.pending(pending) : money(missing, currency), tone: 'debt' };
}

export function summarize(game: GameMeta): GameSummary {
  const totals = computeTotals(game);
  const pending = totals.people - totals.paid;
  const badge = badgeFor(totals.people, pending, totals.missing, game.currency);
  return {
    id: game.id,
    title: game.title.trim() || es.game.unnamed,
    date: es.history.created(formatDate(game.createdAt)),
    detail: es.history.paidOf(totals.paid, totals.people),
    amount: badge.text,
    badge,
    debt: totals.missing ?? 0,
    currency: game.currency,
    linked: !!game.share,
    thumb: game.thumb,
  };
}

export function groupGames(games: GameMeta[]) {
  const summaries = games.map(summarize);
  return {
    debts: summaries.filter((summary) => summary.badge.tone === 'debt'),
    settled: summaries.filter((summary) => summary.badge.tone !== 'debt'),
  };
}

export function debtSummary(summaries: GameSummary[]): string {
  const owing = summaries.filter((summary) => summary.debt > 0);
  if (owing.length === 0) return es.history.nobodyOwes;
  const byCurrency = new Map<string, number>();
  for (const summary of owing) byCurrency.set(summary.currency, (byCurrency.get(summary.currency) ?? 0) + summary.debt);
  const amounts = [...byCurrency].map(([currency, total]) => money(total, currency)).join(es.history.and);
  return es.history.owed(amounts, owing.length);
}

function createElement<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, className = '', text = ''): HTMLElementTagNameMap[Tag] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function thumbElement(summary: GameSummary): HTMLElement {
  if (!summary.thumb) {
    const empty = createElement('span', 'thumb thumb-empty', '🏀');
    empty.setAttribute('aria-hidden', 'true');
    return empty;
  }
  const image = createElement('img', 'thumb');
  image.src = summary.thumb;
  image.alt = '';
  return image;
}

function actionButton(action: string, label: string): HTMLButtonElement {
  const button = createElement('button', `menu-item${action === 'delete' ? ' is-danger' : ''}`, label);
  button.type = 'button';
  button.dataset.action = action;
  return button;
}

function rowMenu(summary: GameSummary): HTMLDetailsElement {
  const menu = createElement('details', 'row-menu');
  const toggle = createElement('summary', 'icon-btn');
  toggle.setAttribute('aria-label', es.history.options(summary.title));
  toggle.append(createElement('span', '', '⋯'));
  toggle.firstElementChild!.setAttribute('aria-hidden', 'true');
  const list = createElement('div', 'menu');
  list.append(actionButton('repeat', es.history.repeat), actionButton('delete', es.history.remove));
  menu.append(toggle, list);
  return menu;
}

function rowElement(summary: GameSummary, isCurrent: boolean): HTMLLIElement {
  const row = createElement('li', `game-row${isCurrent ? ' is-current' : ''}`);
  row.dataset.id = summary.id;

  const openButton = createElement('button', 'game-open');
  openButton.type = 'button';
  openButton.dataset.action = 'open';
  if (isCurrent) openButton.setAttribute('aria-current', 'true');
  const text = createElement('span', 'game-row-text');
  text.append(createElement('strong', '', summary.title), createElement('span', '', `${summary.date} · ${summary.detail}`));
  if (summary.linked) text.append(createElement('span', 'tag tag-live', es.history.linkActive));
  const amount = createElement('span', `row-amount is-${summary.badge.tone}`, summary.amount);
  openButton.append(thumbElement(summary), text, amount);

  row.append(openButton, rowMenu(summary));
  return row;
}

function sectionElement(title: string, summaries: GameSummary[], currentId: string | null): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (summaries.length === 0) return fragment;
  const list = createElement('ul', 'game-list');
  list.append(...summaries.map((summary) => rowElement(summary, summary.id === currentId)));
  fragment.append(createElement('h3', 'drawer-section', title), list);
  return fragment;
}

type HistoryElements = { list: HTMLElement; summary: HTMLElement; empty: HTMLElement };

export function renderHistory(elements: HistoryElements, games: GameMeta[], currentId: string | null) {
  const { debts, settled } = groupGames(games);
  elements.list.replaceChildren(sectionElement(es.history.debts, debts, currentId), sectionElement(es.history.settled, settled, currentId));
  elements.summary.textContent = games.length ? debtSummary([...debts, ...settled]) : '';
  elements.empty.hidden = games.length > 0;
}
