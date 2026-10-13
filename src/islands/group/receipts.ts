import { signal } from '@preact/signals';
import type { GroupLink } from '../../scripts/group/model';
import { loadReceipt, markUploaded, pendingUploads, receiptIds } from '../../scripts/group/receipts';
import { dropReceipt, pullReceipt, pushReceipt } from '../../scripts/group/remote';
import { group } from './store';

export const receiptSet = signal<Set<string>>(new Set());

// Photos the group's shared link doesn't have yet; empty when the group isn't shared.
export const pendingSet = signal<Set<string>>(new Set());

// The read-only link the viewer was opened with; editors use the group's own share.
export const viewerLink = signal<Pick<GroupLink, 'id' | 'key'> | null>(null);

export async function refreshReceipts() {
  const groupId = group.value?.id;
  const shareId = group.value?.share?.id;
  const ids = groupId ? await receiptIds(groupId) : new Set<string>();
  const pending = groupId && shareId ? new Set(await pendingUploads(groupId, shareId)) : new Set<string>();
  if (group.value?.id !== groupId) return;
  receiptSet.value = ids;
  pendingSet.value = pending;
}

export async function findReceipt(groupId: string, expenseId: string): Promise<string | null> {
  const local = await loadReceipt(groupId, expenseId).catch(() => null);
  if (local) return local;
  const link = group.value?.share ?? viewerLink.value;
  return link ? pullReceipt(link, expenseId) : null;
}

// After a failed upload (Blob down or out of quota) the next sync waits this long before trying again.
export const UPLOAD_RETRY_MS = 5 * 60_000;

let pausedUntil = 0;
let running: Promise<void> | null = null;
let queued: { groupId: string; link: GroupLink } | null = null;

async function uploadPending(groupId: string, link: GroupLink) {
  if (Date.now() < pausedUntil) return;
  for (const expenseId of await pendingUploads(groupId, link.id)) {
    const photo = await loadReceipt(groupId, expenseId);
    if (!photo) continue;
    if (!(await pushReceipt(link, expenseId, photo))) {
      pausedUntil = Date.now() + UPLOAD_RETRY_MS;
      return;
    }
    // A photo replaced or removed while uploading stays pending for the next run.
    if ((await loadReceipt(groupId, expenseId)) === photo) await markUploaded(groupId, expenseId, link.id);
  }
}

// Uploads the photos the shared link is missing: ones taken before sharing, before Blob existed, or whose upload failed.
export function uploadPendingReceipts(groupId: string, link: GroupLink): Promise<void> {
  queued = { groupId, link };
  running ??= (async () => {
    while (queued) {
      const next = queued;
      queued = null;
      await uploadPending(next.groupId, next.link).catch(() => undefined);
    }
    await refreshReceipts().catch(() => undefined);
  })().finally(() => {
    running = null;
  });
  return running;
}

export function shareReceipt(groupId: string, expenseId: string, photo: string | null) {
  const link = group.value?.id === groupId ? group.value.share : null;
  if (!link) return;
  if (!photo) {
    void dropReceipt(link, expenseId);
    return;
  }
  pausedUntil = 0;
  void uploadPendingReceipts(groupId, link);
}

export function resetReceiptUploads() {
  pausedUntil = 0;
  queued = null;
  running = null;
}
