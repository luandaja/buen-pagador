import { signal } from '@preact/signals';
import type { GroupLink } from '../../scripts/group/model';
import { loadReceipt, receiptIds } from '../../scripts/group/receipts';
import { dropReceipt, pullReceipt, pushReceipt } from '../../scripts/group/remote';
import { group } from './store';

export const receiptSet = signal<Set<string>>(new Set());

// The read-only link the viewer was opened with; editors use the group's own share.
export const viewerLink = signal<Pick<GroupLink, 'id' | 'key'> | null>(null);

export async function refreshReceipts() {
  const groupId = group.value?.id;
  const ids = groupId ? await receiptIds(groupId) : new Set<string>();
  if (group.value?.id === groupId) receiptSet.value = ids;
}

export async function findReceipt(groupId: string, expenseId: string): Promise<string | null> {
  const local = await loadReceipt(groupId, expenseId).catch(() => null);
  if (local) return local;
  const link = group.value?.share ?? viewerLink.value;
  return link ? pullReceipt(link, expenseId) : null;
}

export function shareReceipt(groupId: string, expenseId: string, photo: string | null) {
  const link = group.value?.id === groupId ? group.value.share : null;
  if (!link) return;
  void (photo ? pushReceipt(link, expenseId, photo) : dropReceipt(link, expenseId));
}

export async function shareAllReceipts(groupId: string, link: GroupLink) {
  for (const expenseId of await receiptIds(groupId)) {
    const photo = await loadReceipt(groupId, expenseId);
    if (photo) await pushReceipt(link, expenseId, photo);
  }
}
