import { createId, pickEmojis } from '../state';

export const GROUP_SCHEMA_VERSION = 2;

export interface Person {
  id: string;
  name: string;
  emoji: string;
  settled: number;
}

export interface Expense {
  id: string;
  what: string;
  amount: number;
  by: string;
  for?: string[];
  note?: string;
}

export interface Group {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  emoji: string;
  currency: string;
  palette: string;
  people: Person[];
  expenses: Expense[];
}

export type Status = 'collector' | 'even' | 'settled' | 'owes' | 'owed';

export interface Balance {
  person: Person;
  paid: number;
  share: number;
  net: number;
  pending: number;
  status: Status;
}

export interface GroupTotals {
  spent: number;
  pending: number;
  settledPeople: number;
  peopleToSettle: number;
}

export const DEFAULT_GROUP_EMOJI = '🧾';
export const DEFAULT_PALETTE = 'cancha';

const CENT_TOLERANCE = 0.5;

export function newGroup(base: Partial<Pick<Group, 'title' | 'emoji' | 'currency' | 'palette'>> = {}): Group {
  const now = Date.now();
  return {
    id: createId(),
    createdAt: now,
    updatedAt: now,
    title: '',
    emoji: DEFAULT_GROUP_EMOJI,
    currency: 'S/',
    palette: DEFAULT_PALETTE,
    people: [],
    expenses: [],
    ...base,
  };
}

export const toCents = (amount: number) => Math.round(amount * 100);
export const fromCents = (cents: number) => cents / 100;

export function splitCents(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
}

export const collectorOf = (group: Pick<Group, 'people'>): Person | undefined => group.people[0];

export function beneficiaries(expense: Expense, people: Person[]): string[] {
  const ids = people.map((person) => person.id);
  const chosen = expense.for?.filter((id) => ids.includes(id));
  return chosen?.length ? chosen : ids;
}

function centsByPerson(group: Pick<Group, 'people' | 'expenses'>) {
  const paid = new Map(group.people.map((person) => [person.id, 0]));
  const share = new Map(paid);
  for (const expense of group.expenses) {
    const cents = toCents(expense.amount);
    if (paid.has(expense.by)) paid.set(expense.by, paid.get(expense.by)! + cents);
    const among = beneficiaries(expense, group.people);
    splitCents(cents, among.length).forEach((part, index) => share.set(among[index], share.get(among[index])! + part));
  }
  return { paid, share };
}

function statusOf(isCollector: boolean, net: number, pending: number): Status {
  if (isCollector) return 'collector';
  if (Math.abs(net) < CENT_TOLERANCE) return 'even';
  if (Math.abs(pending) < CENT_TOLERANCE) return 'settled';
  return pending < 0 ? 'owes' : 'owed';
}

export function computeBalances(group: Pick<Group, 'people' | 'expenses'>): Balance[] {
  const { paid, share } = centsByPerson(group);
  const collectorId = collectorOf(group)?.id;
  return group.people.map((person) => {
    const net = paid.get(person.id)! - share.get(person.id)!;
    const pending = net + toCents(person.settled);
    return {
      person,
      paid: fromCents(paid.get(person.id)!),
      share: fromCents(share.get(person.id)!),
      net: fromCents(net),
      pending: fromCents(pending),
      status: statusOf(person.id === collectorId, net, pending),
    };
  });
}

export function computeGroupTotals(group: Pick<Group, 'people' | 'expenses'>): GroupTotals {
  const balances = computeBalances(group).filter((balance) => balance.status !== 'collector');
  const toSettle = balances.filter((balance) => balance.status !== 'even');
  const owing = toSettle.filter((balance) => balance.status === 'owes');
  return {
    spent: fromCents(group.expenses.reduce((sum, expense) => sum + toCents(expense.amount), 0)),
    pending: fromCents(owing.reduce((sum, balance) => sum - toCents(balance.pending), 0)),
    settledPeople: toSettle.filter((balance) => balance.status === 'settled').length,
    peopleToSettle: toSettle.length,
  };
}

const touch = (group: Group, patch: Partial<Group>): Group => ({ ...group, ...patch, updatedAt: Date.now() });

export function addPerson(group: Group, name: string, blocked: string[] = []): Group {
  const trimmed = name.trim();
  if (!trimmed) return group;
  const [emoji] = pickEmojis(1, group.people.map((person) => person.emoji), blocked);
  return touch(group, { people: [...group.people, { id: createId(), name: trimmed, emoji, settled: 0 }] });
}

export const isReferenced = (group: Pick<Group, 'expenses'>, personId: string) =>
  group.expenses.some((expense) => expense.by === personId || expense.for?.includes(personId));

export function removePerson(group: Group, personId: string): Group {
  if (isReferenced(group, personId)) return group;
  return touch(group, { people: group.people.filter((person) => person.id !== personId) });
}

export function renamePerson(group: Group, personId: string, name: string): Group {
  const trimmed = name.trim();
  if (!trimmed) return group;
  return touch(group, { people: group.people.map((person) => (person.id === personId ? { ...person, name: trimmed } : person)) });
}

export function saveExpense(group: Group, expense: Expense): Group {
  const exists = group.expenses.some((current) => current.id === expense.id);
  const expenses = exists
    ? group.expenses.map((current) => (current.id === expense.id ? expense : current))
    : [...group.expenses, expense];
  return touch(group, { expenses });
}

export const removeExpense = (group: Group, expenseId: string): Group =>
  touch(group, { expenses: group.expenses.filter((expense) => expense.id !== expenseId) });

export function toggleSettled(group: Group, personId: string): Group {
  const balance = computeBalances(group).find((current) => current.person.id === personId);
  if (!balance || balance.status === 'collector' || balance.status === 'even') return group;
  const settled = balance.status === 'settled' ? 0 : -balance.net;
  return touch(group, { people: group.people.map((person) => (person.id === personId ? { ...person, settled } : person)) });
}

export function isValidEmoji(text: string): boolean {
  const segments = [...new Intl.Segmenter().segment(text.trim())];
  return segments.length === 1 && /\p{Extended_Pictographic}/u.test(text);
}

export const GROUP_EMOJIS = ['🧾', '✈️', '🏖️', '🏕️', '🍕', '🍻', '🎂', '🎁', '🏠', '🚗', '🎉', '🛒', '⚽', '🏀', '🎮', '🍣'];
