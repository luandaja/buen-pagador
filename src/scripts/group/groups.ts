import { database } from '../db';
import type { Group } from './model';

export async function listGroups(): Promise<Group[]> {
  const groups = await (await database()).getAll('groups');
  return groups.sort((first, second) => second.updatedAt - first.updatedAt);
}

export async function loadGroup(groupId: string): Promise<Group | null> {
  return (await (await database()).get('groups', groupId)) ?? null;
}

export async function saveGroup(group: Group): Promise<void> {
  await (await database()).put('groups', group);
}

export async function deleteGroup(groupId: string): Promise<void> {
  const transaction = (await database()).transaction(['groups', 'receipts'], 'readwrite');
  const receipts = transaction.objectStore('receipts');
  const keys = await receipts.getAllKeys(IDBKeyRange.bound(`${groupId}:`, `${groupId}:￿`));
  await Promise.all([transaction.objectStore('groups').delete(groupId), ...keys.map((key) => receipts.delete(key)), transaction.done]);
}

const CURRENT_KEY = 'buen-pagador:current-group';

export function currentGroupId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function rememberGroup(groupId: string | null) {
  try {
    if (groupId) localStorage.setItem(CURRENT_KEY, groupId);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    return;
  }
}
