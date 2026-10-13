import { database } from '../db';

const receiptKey = (groupId: string, expenseId: string) => `${groupId}:${expenseId}`;

// A new photo counts as not uploaded until it reaches the shared link.
export async function saveReceipt(groupId: string, expenseId: string, dataUrl: string): Promise<void> {
  const db = await database();
  await db.put('receipts', dataUrl, receiptKey(groupId, expenseId));
  await db.delete('receiptUploads', receiptKey(groupId, expenseId));
}

export async function loadReceipt(groupId: string, expenseId: string): Promise<string | null> {
  return (await (await database()).get('receipts', receiptKey(groupId, expenseId))) ?? null;
}

export async function deleteReceipt(groupId: string, expenseId: string): Promise<void> {
  const db = await database();
  await db.delete('receipts', receiptKey(groupId, expenseId));
  await db.delete('receiptUploads', receiptKey(groupId, expenseId));
}

const groupRange = (groupId: string) => IDBKeyRange.bound(`${groupId}:`, `${groupId}:￿`);

export async function receiptIds(groupId: string): Promise<Set<string>> {
  const keys = await (await database()).getAllKeys('receipts', groupRange(groupId));
  return new Set(keys.map((key) => key.slice(groupId.length + 1)));
}

export async function markUploaded(groupId: string, expenseId: string, shareId: string | null): Promise<void> {
  const db = await database();
  if (shareId) await db.put('receiptUploads', shareId, receiptKey(groupId, expenseId));
  else await db.delete('receiptUploads', receiptKey(groupId, expenseId));
}

// Photos kept on this device that the given shared link doesn't have yet.
export async function pendingUploads(groupId: string, shareId: string): Promise<string[]> {
  const db = await database();
  const [ids, keys, links] = await Promise.all([
    receiptIds(groupId),
    db.getAllKeys('receiptUploads', groupRange(groupId)),
    db.getAll('receiptUploads', groupRange(groupId)),
  ]);
  const uploaded = new Set(keys.filter((_, index) => links[index] === shareId).map((key) => key.slice(groupId.length + 1)));
  return [...ids].filter((id) => !uploaded.has(id));
}
