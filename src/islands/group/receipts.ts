import { signal } from '@preact/signals';
import { receiptIds } from '../../scripts/group/receipts';
import { group } from './store';

export const receiptSet = signal<Set<string>>(new Set());

export async function refreshReceipts() {
  const groupId = group.value?.id;
  const ids = groupId ? await receiptIds(groupId) : new Set<string>();
  if (group.value?.id === groupId) receiptSet.value = ids;
}
