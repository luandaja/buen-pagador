import { signal } from '@preact/signals';
import { diff, fromPlain, isEmptyDiff, merge, toPlain, type Plain } from '../../scripts/group/codec';
import { listGroups } from '../../scripts/group/groups';
import { newGroup, type Group, type GroupLink } from '../../scripts/group/model';
import { createRemote, deleteRemote, pullRemote, pushRemote } from '../../scripts/group/remote';
import { ShareError, parseMasterHash } from '../../scripts/share';
import { flush, group, onEdit, openGroup } from './store';

export type SyncStatus = 'off' | 'busy' | 'ok' | 'offline' | 'gone';

export const syncStatus = signal<SyncStatus>('off');

export const SYNC_DEBOUNCE_MS = 800;
export const SYNC_POLL_MS = 15_000;
export const SYNC_RETRY_MS = 5_000;

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;

export function scheduleSync(delay = SYNC_DEBOUNCE_MS) {
  clearTimeout(timer);
  if (!group.value?.share) return;
  timer = setTimeout(() => void syncNow(), delay);
}

onEdit(() => {
  if (!group.value?.share) return;
  syncStatus.value = 'busy';
  scheduleSync();
});

const isGone = (error: unknown) => error instanceof ShareError && (error.status === 404 || error.status === 403);

async function dropShare(groupId: string) {
  if (group.value?.id !== groupId) return;
  group.value = { ...group.value, share: null, sync: null };
  await flush();
}

async function onSyncError(error: unknown, groupId: string) {
  if (isGone(error)) {
    syncStatus.value = 'gone';
    await dropShare(groupId);
    return;
  }
  syncStatus.value = 'offline';
  scheduleSync(SYNC_RETRY_MS);
}

async function apply(start: Group, pushedBase: Plain, remote: Plain, v: number) {
  const current = group.value;
  if (current?.id !== start.id) return;
  const local = toPlain(current);
  const merged = merge(pushedBase, local, remote);
  const changed = !isEmptyDiff(diff(local, merged)) || current.sync?.v !== v;
  if (!changed) return;
  group.value = { ...fromPlain(merged, current), sync: { v, fields: remote } };
  await flush();
  if (!isEmptyDiff(diff(remote, merged))) again = true;
}

async function cycle(start: Group, link: GroupLink) {
  const base = start.sync ?? { v: 0, fields: {} };
  const local = toPlain(start);
  const changes = diff(base.fields, local);
  const hasChanges = !isEmptyDiff(changes);
  if (hasChanges) await pushRemote(link, changes.set, changes.del);
  const pulled = await pullRemote(link, hasChanges ? undefined : base.v);
  const remote = 'unchanged' in pulled ? base.fields : pulled.plain;
  await apply(start, hasChanges ? local : base.fields, remote, pulled.v);
  noteExpiry(start.id, pulled.expiresAt);
}

function noteExpiry(groupId: string, expiresAt: number | undefined) {
  const current = group.value;
  if (current?.id !== groupId || !current.share || !expiresAt) return;
  group.value = { ...current, share: { ...current.share, expiresAt } };
}

export async function syncNow() {
  const start = group.value;
  if (!start?.share) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  clearTimeout(timer);
  syncStatus.value = 'busy';
  try {
    await cycle(start, start.share);
    syncStatus.value = 'ok';
    scheduleSync(SYNC_POLL_MS);
  } catch (error) {
    await onSyncError(error, start.id);
  } finally {
    running = false;
  }
  if (again) {
    again = false;
    await syncNow();
  }
}

export async function startSharing() {
  const start = group.value;
  if (!start || start.share) return;
  syncStatus.value = 'busy';
  try {
    const plain = toPlain(start);
    const { link, v } = await createRemote(plain);
    group.value = { ...group.value!, share: link, sync: { v, fields: plain } };
    await flush();
    syncStatus.value = 'ok';
    scheduleSync(group.value === start ? SYNC_POLL_MS : SYNC_DEBOUNCE_MS);
  } catch {
    syncStatus.value = 'offline';
  }
}

export async function stopSharing() {
  const current = group.value;
  if (!current?.share) return;
  try {
    if (current.share.owner) await deleteRemote(current.share);
  } catch (error) {
    if (!isGone(error)) {
      syncStatus.value = 'offline';
      return;
    }
  }
  clearTimeout(timer);
  syncStatus.value = 'off';
  await dropShare(current.id);
}

export async function joinFromHash(hash: string): Promise<boolean> {
  const parsed = parseMasterHash(hash);
  if (!parsed) return false;
  const known = (await listGroups()).find((saved) => saved.share?.id === parsed.id);
  if (known) {
    await openGroup(known.id);
  } else {
    const joined = newGroup();
    group.value = { ...joined, share: { ...parsed, owner: false }, sync: { v: 0, fields: toPlain(joined) } };
  }
  await syncNow();
  return true;
}

export function syncWhenVisible() {
  if (document.visibilityState === 'visible') void syncNow();
}

export function resetSync() {
  clearTimeout(timer);
  running = false;
  again = false;
  syncStatus.value = 'off';
}
