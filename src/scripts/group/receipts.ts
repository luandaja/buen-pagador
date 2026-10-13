import { database } from '../db';

const receiptKey = (groupId: string, expenseId: string) => `${groupId}:${expenseId}`;

export async function saveReceipt(groupId: string, expenseId: string, dataUrl: string): Promise<void> {
  await (await database()).put('receipts', dataUrl, receiptKey(groupId, expenseId));
}

export async function loadReceipt(groupId: string, expenseId: string): Promise<string | null> {
  return (await (await database()).get('receipts', receiptKey(groupId, expenseId))) ?? null;
}

export async function deleteReceipt(groupId: string, expenseId: string): Promise<void> {
  await (await database()).delete('receipts', receiptKey(groupId, expenseId));
}

export async function receiptIds(groupId: string): Promise<Set<string>> {
  const keys = await (await database()).getAllKeys('receipts', IDBKeyRange.bound(`${groupId}:`, `${groupId}:￿`));
  return new Set(keys.map((key) => key.slice(groupId.length + 1)));
}
