// Historial de partidos: resúmenes (puros) y la lista en el DOM.
import type { GameMeta } from './games';
import { computeTotals, money } from './state';

export interface GameSummary {
  id: string;
  title: string;
  date: string;
  detail: string;
  /** Monto destacado a la derecha ("S/ 110" o "Pagado ✓"). */
  amount: string;
  badge: { text: string; tone: 'debt' | 'paid' | 'empty' };
  debt: number;
  currency: string;
  linked: boolean;
  thumb: string | null;
}

const dateFormat = new Intl.DateTimeFormat('es-PE', { weekday: 'short', day: 'numeric', month: 'short' });

export const formatDate = (ts: number) => dateFormat.format(new Date(ts)).replace(/\./g, '');

function badgeFor(people: number, pending: number, missing: number | null, currency: string): GameSummary['badge'] {
  if (people === 0) return { text: 'Sin jugadores', tone: 'empty' };
  if (pending === 0) return { text: 'Pagado', tone: 'paid' };
  return { text: missing == null ? `Faltan ${pending}` : money(missing, currency), tone: 'debt' };
}

export function summarize(game: GameMeta): GameSummary {
  const t = computeTotals(game);
  const pending = t.people - t.paid;
  return {
    id: game.id,
    title: game.title.trim() || 'Partido sin nombre',
    date: `Creado ${formatDate(game.createdAt)}`,
    detail: `${t.paid}/${t.people}\u00a0pagaron`,
    amount: badgeFor(t.people, pending, t.missing, game.currency).text,
    badge: badgeFor(t.people, pending, t.missing, game.currency),
    debt: t.missing ?? 0,
    currency: game.currency,
    linked: !!game.share,
    thumb: game.thumb,
  };
}

/** Primero los que tienen deudas; después los pagados (o vacíos). */
export function groupGames(games: GameMeta[]) {
  const summaries = games.map(summarize);
  return {
    debts: summaries.filter((s) => s.badge.tone === 'debt'),
    settled: summaries.filter((s) => s.badge.tone !== 'debt'),
  };
}

/** "Te deben S/ 25 en 2 partidos", sumando por moneda. */
export function debtSummary(summaries: GameSummary[]): string {
  const owing = summaries.filter((s) => s.debt > 0);
  if (owing.length === 0) return 'Nadie te debe nada.';
  const byCurrency = new Map<string, number>();
  for (const s of owing) byCurrency.set(s.currency, (byCurrency.get(s.currency) ?? 0) + s.debt);
  const amounts = [...byCurrency].map(([currency, total]) => money(total, currency)).join(' y ');
  return `Te deben ${amounts} en ${owing.length === 1 ? '1 partido' : `${owing.length} partidos`}.`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function thumbEl(summary: GameSummary): HTMLElement {
  if (!summary.thumb) {
    const empty = el('span', 'thumb thumb-empty', '🏀');
    empty.setAttribute('aria-hidden', 'true');
    return empty;
  }
  const img = el('img', 'thumb');
  img.src = summary.thumb;
  img.alt = '';
  return img;
}

function actionButton(action: string, label: string): HTMLButtonElement {
  const btn = el('button', `menu-item${action === 'delete' ? ' is-danger' : ''}`, label);
  btn.type = 'button';
  btn.dataset.action = action;
  return btn;
}

/** Menú ⋯ de cada partido: repetir o borrar. */
function rowMenu(summary: GameSummary): HTMLDetailsElement {
  const menu = el('details', 'row-menu');
  const toggle = el('summary', 'icon-btn');
  toggle.setAttribute('aria-label', `Opciones de ${summary.title}`);
  toggle.append(el('span', '', '⋯'));
  toggle.firstElementChild!.setAttribute('aria-hidden', 'true');
  const list = el('div', 'menu');
  list.append(actionButton('repeat', 'Repetir partido'), actionButton('delete', 'Borrar de este dispositivo'));
  menu.append(toggle, list);
  return menu;
}

function rowEl(summary: GameSummary, current: boolean): HTMLLIElement {
  const li = el('li', `game-row${current ? ' is-current' : ''}`);
  li.dataset.id = summary.id;

  const open = el('button', 'game-open');
  open.type = 'button';
  open.dataset.action = 'open';
  if (current) open.setAttribute('aria-current', 'true');
  const text = el('span', 'game-row-text');
  text.append(el('strong', '', summary.title), el('span', '', `${summary.date} · ${summary.detail}`));
  if (summary.linked) text.append(el('span', 'tag tag-live', 'Link activo'));
  const amount = el('span', `row-amount is-${summary.badge.tone}`, summary.amount);
  open.append(thumbEl(summary), text, amount);

  li.append(open, rowMenu(summary));
  return li;
}

function sectionEl(title: string, summaries: GameSummary[], currentId: string | null): DocumentFragment {
  const fragment = document.createDocumentFragment();
  if (summaries.length === 0) return fragment;
  const list = el('ul', 'game-list');
  list.append(...summaries.map((s) => rowEl(s, s.id === currentId)));
  fragment.append(el('h3', 'drawer-section', title), list);
  return fragment;
}

type HistoryEls = { list: HTMLElement; summary: HTMLElement; empty: HTMLElement };

/** Pinta la lista agrupada y el resumen de deudas. */
export function renderHistory(els: HistoryEls, games: GameMeta[], currentId: string | null) {
  const { debts, settled } = groupGames(games);
  els.list.replaceChildren(sectionEl('Con deudas', debts, currentId), sectionEl('Pagados', settled, currentId));
  els.summary.textContent = games.length ? debtSummary([...debts, ...settled]) : '';
  els.empty.hidden = games.length > 0;
}
