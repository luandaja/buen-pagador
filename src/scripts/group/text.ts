import { es } from '../../i18n/es';
import { money } from '../state';
import { beneficiaries, type Balance, type Expense, type Person } from './model';

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
  const among = beneficiaries(expense, people);
  if (among.length === people.length) return t.everyone;
  const names = among.map((id) => people.find((person) => person.id === id)!.name);
  return t.amongNames(listNames(names));
}

export function payerName(expense: Expense, people: Person[]): string {
  return people.find((person) => person.id === expense.by)?.name ?? '—';
}
