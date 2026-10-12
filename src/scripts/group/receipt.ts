import { createId } from '../state';
import { fromCents, splitCents, toCents, type Expense } from './model';

export interface ParsedItem {
  what: string;
  quantity: number;
  amount: number;
}

export interface ParsedReceipt {
  merchant: string;
  items: ParsedItem[];
  tip: number;
  total: number | null;
}

export interface DraftItem {
  id: string;
  what: string;
  amount: string;
  quantity: number;
  for: string[];
}

const MAX_ITEMS = 100;
const MAX_AMOUNT = 100_000;
const MAX_NAME = 60;

export function toAmount(value: unknown): number | null {
  const amount = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= MAX_AMOUNT ? Math.round(amount * 100) / 100 : null;
}

const cleanName = (value: unknown) =>
  String(value ?? '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N})]+$/u, '')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_NAME);

const toQuantity = (value: unknown) => {
  const quantity = Math.round(Number(value));
  return Number.isFinite(quantity) && quantity >= 1 && quantity <= 99 ? quantity : 1;
};

function lineAmount(amount: number | null, unitPrice: number | null, quantity: number): number | null {
  if (!amount || quantity === 1 || !unitPrice || amount !== unitPrice) return amount;
  return Math.round(unitPrice * quantity * 100) / 100;
}

function normalizeItem(raw: unknown): ParsedItem | null {
  const item = (raw ?? {}) as Record<string, unknown>;
  const what = cleanName(item.name ?? item.what);
  const quantity = toQuantity(item.quantity);
  const amount = lineAmount(toAmount(item.amount), toAmount(item.unitPrice), quantity);
  return what && amount ? { what, quantity, amount } : null;
}

const centsOf = (value: number) => Math.round(value * 100);

function extrasOf(data: Record<string, unknown>, items: ParsedItem[], total: number | null): number {
  const tip = toAmount(data.tip) ?? 0;
  const sum = items.reduce((acc, item) => acc + centsOf(item.amount), 0);
  if (total && sum + centsOf(tip) === centsOf(total)) return tip;
  return tip + (toAmount(data.charges) ?? 0) - (toAmount(data.discount) ?? 0);
}

function plausibleTotal(total: number | null, items: ParsedItem[], extras: number): number | null {
  const sum = items.reduce((acc, item) => acc + item.amount, 0);
  return total && total + 0.005 >= sum + Math.min(0, extras) ? total : null;
}

export function normalizeParsed(raw: unknown): ParsedReceipt {
  const data = (raw ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(data.items) ? data.items : []).map(normalizeItem).filter((item): item is ParsedItem => item !== null);
  const kept = items.slice(0, MAX_ITEMS);
  const total = toAmount(data.total);
  const extras = extrasOf(data, kept, total);
  return { merchant: cleanName(data.merchant), items: kept, tip: Math.max(0, Math.round(extras * 100) / 100), total: plausibleTotal(total, kept, extras) };
}

export function parseJsonReply(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const TOTALS_WORD = /^(?:sub-?total|total|igv|iva|rc|propina|tarjeta|son|vuelto|efectivo|descuento|cambio)\b/i;
const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('es') + text.slice(1);

const ITEM_LINE = /^(.*\p{L}.*?)\s+(\d{1,2})\s+\D{0,3}?(\d{1,5}[.,]\d{2})\b/u;
const AMOUNT_LINE = /^\D{0,2}(\d{1,5}[.,]\d{2})\b/;

function amountBelow(unit: number, quantity: number, next: string | undefined): number {
  const below = toAmount(AMOUNT_LINE.exec(next?.trim() ?? '')?.[1]);
  const multiplied = Math.round(unit * quantity * 100) / 100;
  return quantity > 1 && below && Math.abs(below - multiplied) < 1 ? below : multiplied;
}

function lineItem(line: string, next: string | undefined): ParsedItem | null {
  const match = ITEM_LINE.exec(line.trim());
  if (!match) return null;
  const quantity = toQuantity(match[2]);
  const amount = amountBelow(toAmount(match[3])!, quantity, next);
  const what = capitalize(cleanName(match[1]));
  return what && amount && !TOTALS_WORD.test(what) ? { what, quantity, amount } : null;
}

export function parseReceiptText(text: string): ParsedReceipt {
  const lines = text.split('\n');
  const items = lines.map((line, index) => lineItem(line, lines[index + 1])).filter((item): item is ParsedItem => item !== null);
  return { merchant: '', items: items.slice(0, MAX_ITEMS), tip: 0, total: null };
}

export function draftItems(parsed: ParsedReceipt): DraftItem[] {
  return parsed.items.map((item) => ({ id: createId(), what: item.what, amount: item.amount.toFixed(2), quantity: item.quantity, for: [] }));
}

export function splitUnits(item: DraftItem): DraftItem[] {
  const cents = toCents(toAmount(item.amount) ?? 0);
  return splitCents(cents, item.quantity).map((part) => ({ ...item, id: createId(), amount: fromCents(part).toFixed(2), quantity: 1 }));
}

export interface ReceiptCheck {
  orphans: number;
  sum: number;
  difference: number | null;
  ready: boolean;
}

export function checkReceipt(items: DraftItem[], tip: string, total: string): ReceiptCheck {
  const orphans = items.filter((item) => item.for.length === 0).length;
  const cents = items.reduce((acc, item) => acc + toCents(toAmount(item.amount) ?? 0), 0) + toCents(toAmount(tip) ?? 0);
  const expected = toAmount(total);
  const difference = expected ? fromCents(toCents(expected) - cents) : null;
  return { orphans, sum: fromCents(cents), difference, ready: items.length > 0 && orphans === 0 && difference === 0 };
}

export interface ReceiptDraft {
  what: string;
  by: string;
  items: DraftItem[];
  tip: string;
  total: string;
}

export const newDraftItem = (what: string, amount = ''): DraftItem => ({ id: createId(), what, amount, quantity: 1, for: [] });

export const updateItem = (items: DraftItem[], id: string, patch: Partial<DraftItem>) => items.map((item) => (item.id === id ? { ...item, ...patch } : item));

export const removeItem = (items: DraftItem[], id: string) => items.filter((item) => item.id !== id);

export const splitItem = (items: DraftItem[], id: string) => items.flatMap((item) => (item.id === id ? splitUnits(item) : [item]));

export const formatAmount = (value: number | null) => (value == null ? '' : value.toFixed(2));

export function draftFromParsed(parsed: ParsedReceipt, by: string, fallbackWhat: string): ReceiptDraft {
  return { what: parsed.merchant || fallbackWhat, by, items: draftItems(parsed), tip: formatAmount(parsed.tip || null), total: formatAmount(parsed.total) };
}

export function draftFromExpense(expense: Expense): ReceiptDraft {
  const items = (expense.items ?? []).map((item) => ({ id: item.id, what: item.what, amount: item.amount.toFixed(2), quantity: 1, for: item.for }));
  return { what: expense.what, by: expense.by, items, tip: formatAmount(expense.tip ?? null), total: expense.amount.toFixed(2) };
}

export function expenseFromDraft(draft: ReceiptDraft, base: { id: string; note?: string; at?: number }): Expense {
  const items = draft.items.map((item) => ({ id: item.id, what: item.what.trim() || 'Ítem', amount: toAmount(item.amount) ?? 0, for: item.for }));
  const tip = toAmount(draft.tip) ?? 0;
  const amount = fromCents(items.reduce((sum, item) => sum + toCents(item.amount), 0) + toCents(tip));
  return { ...base, what: draft.what.trim() || 'Boleta', by: draft.by, amount, items, tip: tip || undefined };
}
