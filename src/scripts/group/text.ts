import { es } from '../../i18n/es';
import { money } from '../state';
import { beneficiaries, computeBalances, computeGroupTotals, unassignedItems, type Balance, type Expense, type Group, type Person } from './model';

const t = es.group;

export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

type Format = (value: number) => string;

const doneText = (settled: number, format: Format) => (settled > 0 ? t.paid(format(settled)) : t.received(format(-settled)));

function pendingText(balance: Balance, format: Format): string {
  const { pending, person } = balance;
  if (!person.settled) return pending < 0 ? t.owes(format(-pending)) : t.owed(format(pending));
  const missing = pending < 0 ? t.owesMore(format(-pending)) : t.owedMore(format(pending));
  return t.partial(doneText(person.settled, format), missing);
}

export function statusText(balance: Balance, currency: string): string {
  const format = (value: number) => money(value, currency);
  if (balance.status === 'collector') return t.collector;
  if (balance.status === 'even') return t.even;
  if (balance.status === 'settled') return doneText(-balance.net, format);
  return pendingText(balance, format);
}

export function toggleLabel(balance: Balance): string {
  const { name } = balance.person;
  if (balance.status === 'settled') return t.undo(name);
  return balance.status === 'owed' ? t.markReceived(name) : t.markPaid(name);
}

export function amongText(expense: Expense, people: Person[]): string {
  if (expense.items?.length) {
    const pending = unassignedItems(expense);
    const summary = t.itemsSummary(expense.items.length, !!expense.tip);
    return pending ? `${summary} · ${t.unassigned(pending)}` : summary;
  }
  const among = beneficiaries(expense, people);
  if (among.length === people.length) return t.everyone;
  const names = among.map((id) => people.find((person) => person.id === id)!.name);
  return t.amongNames(listNames(names));
}

export function payerName(expense: Expense, people: Person[]): string {
  return people.find((person) => person.id === expense.by)?.name ?? '—';
}

const SUMMARY_MARK: Record<Balance['status'], string> = { collector: '💰', even: '•', settled: '✓', owes: '•', owed: '•' };

function summaryLine(balance: Balance, currency: string): string {
  return `${SUMMARY_MARK[balance.status]} ${balance.person.name}: ${statusText(balance, currency)}`;
}

export function summaryText(group: Group, publicUrl?: string): string {
  const totals = computeGroupTotals(group);
  const format = (value: number) => money(value, group.currency);
  const done = totals.peopleToSettle > 0 && totals.settledPeople === totals.peopleToSettle;
  const status = done ? t.summaryDone : t.summaryMissing(format(totals.pending), totals.settledPeople, totals.peopleToSettle);
  const people = computeBalances(group).map((balance) => summaryLine(balance, group.currency));
  const lines = [`${group.emoji} ${group.title.trim() || t.unnamed}`, t.summarySpent(format(totals.spent)), status, '', ...people];
  if (publicUrl) lines.push('', t.summaryLink(publicUrl));
  return lines.join('\n');
}
