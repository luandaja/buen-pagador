import { createId } from '../state';

export const GROUP_SCHEMA_VERSION = 2;

export interface Person {
  id: string;
  name: string;
  emoji: string;
  settled: number;
  at?: number;
}

export interface Band {
  top: number;
  bottom: number;
  left?: number;
  right?: number;
}

export interface ReceiptItem {
  id: string;
  what: string;
  amount: number;
  for: string[];
  band?: Band;
}

export interface Expense {
  id: string;
  what: string;
  amount: number;
  by: string;
  for?: string[];
  note?: string;
  at?: number;
  items?: ReceiptItem[];
  tip?: number;
}

export interface GroupLink {
  id: string;
  key: string;
  token: string;
  owner?: boolean;
  expiresAt?: number;
}

export interface SyncState {
  v: number;
  fields: Record<string, string>;
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
  payNote?: string;
  payQr?: string | null;
  share?: GroupLink | null;
  sync?: SyncState | null;
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

export function splitByWeight(total: number, weights: number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum <= 0) return splitCents(total, weights.length);
  const exact = weights.map((weight) => (total * weight) / sum);
  const parts = exact.map(Math.floor);
  const order = exact.map((value, index) => [value - parts[index], index]).sort((first, second) => second[0] - first[0]);
  for (let extra = total - parts.reduce((acc, part) => acc + part, 0), index = 0; extra > 0; extra--, index++) parts[order[index][1]] += 1;
  return parts;
}

function addTo(shares: Map<string, number>, ids: string[], parts: number[]) {
  parts.forEach((part, index) => shares.set(ids[index], (shares.get(ids[index]) ?? 0) + part));
}

function itemOwners(item: ReceiptItem, known: Set<string>, payer: string): string[] {
  if (item.for.length === 0) return known.has(payer) ? [payer] : [...known];
  const among = item.for.filter((id) => known.has(id));
  return among.length ? among : [...known];
}

export const unassignedItems = (expense: Pick<Expense, 'items'>) => (expense.items ?? []).filter((item) => item.for.length === 0).length;

export function itemizedShares(expense: Expense, people: Person[]): Map<string, number> {
  const known = new Set(people.map((person) => person.id));
  const shares = new Map<string, number>();
  for (const item of expense.items ?? []) {
    const ids = itemOwners(item, known, expense.by);
    addTo(shares, ids, splitCents(toCents(item.amount), ids.length));
  }
  const ids = people.map((person) => person.id);
  addTo(shares, ids, splitByWeight(toCents(expense.tip ?? 0), ids.map((id) => shares.get(id) ?? 0)));
  return shares;
}

function expenseShares(expense: Expense, people: Person[]): Map<string, number> {
  if (expense.items?.length) return itemizedShares(expense, people);
  const among = beneficiaries(expense, people);
  const shares = new Map<string, number>();
  addTo(shares, among, splitCents(toCents(expense.amount), among.length));
  return shares;
}

function centsByPerson(group: Pick<Group, 'people' | 'expenses'>) {
  const paid = new Map(group.people.map((person) => [person.id, 0]));
  const share = new Map(paid);
  for (const expense of group.expenses) {
    if (paid.has(expense.by)) paid.set(expense.by, paid.get(expense.by)! + toCents(expense.amount));
    for (const [id, cents] of expenseShares(expense, group.people)) share.set(id, share.get(id)! + cents);
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

export const nextAt = (items: { at?: number }[]) => Math.max(Date.now(), ...items.map((item) => (item.at ?? 0) + 1));

export function addPerson(group: Group, name: string): Group {
  const trimmed = name.trim();
  if (!trimmed) return group;
  const emoji = nextEmoji(null, group.people.map((person) => person.emoji));
  return touch(group, { people: [...group.people, { id: createId(), name: trimmed, emoji, settled: 0, at: nextAt(group.people) }] });
}

export const isReferenced = (group: Pick<Group, 'expenses'>, personId: string) =>
  group.expenses.some((expense) => expense.by === personId || expense.for?.includes(personId) || expense.items?.some((item) => item.for.includes(personId)));

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
    : [...group.expenses, { ...expense, at: expense.at ?? nextAt(group.expenses) }];
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

export const PERSON_EMOJIS = ['🤖', '👻', '👽', '👾', '🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦄', '🐧', '🐢', '🦉', '🐝', '🐳', '🦋', '🌵', '🍄', '⭐', '🌈', '🎈', '🚀'];

export function nextEmoji(current: string | null, taken: string[]): string {
  const start = current ? PERSON_EMOJIS.indexOf(current) + 1 : 0;
  const ordered = [...PERSON_EMOJIS.slice(start), ...PERSON_EMOJIS.slice(0, start)];
  return ordered.find((emoji) => !taken.includes(emoji) && emoji !== current) ?? ordered[0];
}

export function rotateEmoji(group: Group, personId: string): Group {
  const person = group.people.find((current) => current.id === personId);
  if (!person) return group;
  const taken = group.people.filter((other) => other.id !== personId).map((other) => other.emoji);
  const emoji = nextEmoji(person.emoji, taken);
  return touch(group, { people: group.people.map((current) => (current.id === personId ? { ...current, emoji } : current)) });
}

export const GROUP_EMOJIS = ['🧾', '✈️', '🏖️', '🏕️', '🍕', '🍻', '🎂', '🎁', '🏠', '🚗', '🎉', '🛒', '⚽', '🏀', '🎮', '🍣'];
