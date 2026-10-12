import { computed, signal } from '@preact/signals';
import { currentGroupId, deleteGroup, listGroups, loadGroup, rememberGroup, saveGroup } from '../../scripts/group/groups';
import { computeBalances, computeGroupTotals, newGroup, type Group } from '../../scripts/group/model';

export const group = signal<Group | null>(null);
export const savedGroups = signal<Group[]>([]);
export const readOnly = signal(false);

export const balances = computed(() => (group.value ? computeBalances(group.value) : []));
export const totals = computed(() => (group.value ? computeGroupTotals(group.value) : null));

const SAVE_DEBOUNCE_MS = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const editListeners = new Set<() => void>();

export const onEdit = (listener: () => void) => editListeners.add(listener);

export const isBlank = (current: Group) => !current.title.trim() && current.people.length === 0 && current.expenses.length === 0;

export function edit(change: (current: Group) => Group) {
  if (!group.value) return;
  const next = change(group.value);
  if (next === group.value) return;
  group.value = next;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  editListeners.forEach((listener) => listener());
}

export async function flush() {
  clearTimeout(saveTimer);
  const current = group.value;
  if (!current || isBlank(current)) return;
  await saveGroup(current);
  rememberGroup(current.id);
  await refreshList();
}

export async function refreshList() {
  savedGroups.value = await listGroups();
}

function show(next: Group) {
  group.value = next;
  rememberGroup(isBlank(next) ? null : next.id);
}

export async function start() {
  const id = currentGroupId();
  const stored = id ? await loadGroup(id) : null;
  show(stored ?? newGroup());
  await refreshList();
}

export async function openGroup(groupId: string) {
  await flush();
  const stored = await loadGroup(groupId);
  if (stored) show(stored);
}

export async function createGroup() {
  await flush();
  const current = group.value;
  show(newGroup(current ? { currency: current.currency } : {}));
}

export async function removeGroup(groupId: string) {
  await deleteGroup(groupId);
  if (group.value?.id === groupId) show(newGroup());
  await refreshList();
}
