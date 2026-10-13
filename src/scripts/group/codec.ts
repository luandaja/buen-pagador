import { decryptJson, encryptJson } from '../crypto';
import { DEFAULT_GROUP_EMOJI, DEFAULT_PALETTE, GROUP_SCHEMA_VERSION, type Expense, type Group, type Person } from './model';

export type Plain = Record<string, string>;

interface Meta {
  schemaVersion: number;
  title: string;
  emoji: string;
  currency: string;
  palette: string;
  payNote?: string;
}

const META = 'm';
const QR = 'q';
const PERSON = 'p:';
const EXPENSE = 'e:';

export function toPlain(group: Group): Plain {
  const meta: Meta = { schemaVersion: GROUP_SCHEMA_VERSION, title: group.title, emoji: group.emoji, currency: group.currency, palette: group.palette, payNote: group.payNote || undefined };
  const plain: Plain = { [META]: JSON.stringify(meta) };
  if (group.payQr) plain[QR] = JSON.stringify(group.payQr);
  for (const person of group.people) plain[PERSON + person.id] = JSON.stringify(person);
  for (const expense of group.expenses) plain[EXPENSE + expense.id] = JSON.stringify(expense);
  return plain;
}

const byCreation = <T extends { at?: number; id: string }>(items: T[]) =>
  items.sort((first, second) => (first.at ?? 0) - (second.at ?? 0) || first.id.localeCompare(second.id));

function parseItems<T>(plain: Plain, prefix: string): T[] {
  return Object.entries(plain)
    .filter(([name]) => name.startsWith(prefix))
    .map(([, value]) => JSON.parse(value) as T);
}

export function fromPlain(plain: Plain, base: Group): Group {
  const meta: Partial<Meta> = plain[META] ? JSON.parse(plain[META]) : {};
  return {
    ...base,
    title: meta.title ?? base.title,
    emoji: meta.emoji ?? DEFAULT_GROUP_EMOJI,
    currency: meta.currency ?? base.currency,
    palette: meta.palette ?? DEFAULT_PALETTE,
    payNote: meta.payNote ?? '',
    payQr: plain[QR] ? (JSON.parse(plain[QR]) as string) : null,
    people: byCreation(parseItems<Person>(plain, PERSON)),
    expenses: byCreation(parseItems<Expense>(plain, EXPENSE)),
  };
}

export function diff(before: Plain, after: Plain): { set: Plain; del: string[] } {
  const set = Object.fromEntries(Object.entries(after).filter(([name, value]) => before[name] !== value));
  const del = Object.keys(before).filter((name) => !(name in after));
  return { set, del };
}

export const isEmptyDiff = ({ set, del }: { set: Plain; del: string[] }) => Object.keys(set).length === 0 && del.length === 0;

export function merge(base: Plain, local: Plain, remote: Plain): Plain {
  const names = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  const merged: Plain = {};
  for (const name of names) {
    const value = local[name] !== base[name] ? local[name] : remote[name];
    if (value !== undefined) merged[name] = value;
  }
  return merged;
}

export async function encryptFields(key: CryptoKey, plain: Plain): Promise<Plain> {
  const entries = await Promise.all(Object.entries(plain).map(async ([name, value]) => [name, await encryptJson(key, JSON.parse(value))]));
  return Object.fromEntries(entries);
}

export async function decryptFields(key: CryptoKey, fields: Plain): Promise<Plain> {
  const entries = await Promise.all(
    Object.entries(fields).map(async ([name, value]) => {
      try {
        return [name, JSON.stringify(await decryptJson(key, value))];
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}
