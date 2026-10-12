import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, group, savedGroups } from '../../src/islands/group/store';
import { joinFromHash, resetSync, scheduleSync, startSharing, stopSharing, syncNow, syncStatus, syncWhenVisible } from '../../src/islands/group/sync';
import { resetGroupStore } from '../../src/lib/group-store';
import { resetDatabase } from '../../src/scripts/db';
import { toPlain } from '../../src/scripts/group/codec';
import { listGroups, saveGroup } from '../../src/scripts/group/groups';
import { addPerson, newGroup, saveExpense, toggleSettled, type Group, type GroupLink } from '../../src/scripts/group/model';
import { pullRemote, pushRemote } from '../../src/scripts/group/remote';
import { useApiFetch } from '../helpers/api';

const editHash = (link: GroupLink) => `#edit=${link.id}.${link.key}.${link.token}`;

function trip(): Group {
  let current = newGroup({ title: 'Cusco' });
  current = addPerson(addPerson(current, 'Ana'), 'Beto');
  return saveExpense(current, { id: 'hotel', what: 'Hotel', amount: 100, by: current.people[0].id, at: 1 });
}

async function sharedTrip() {
  group.value = trip();
  await startSharing();
  return group.value!.share!;
}

async function remoteNames(link: GroupLink) {
  const pulled = await pullRemote(link);
  return 'plain' in pulled ? Object.keys(pulled.plain).sort() : [];
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDatabase();
  resetGroupStore();
  resetSync();
  localStorage.clear();
  group.value = null;
  savedGroups.value = [];
  useApiFetch();
});

afterEach(() => {
  resetSync();
  vi.useRealTimers();
});

describe('sharing a group', () => {
  it('uploads every item encrypted and remembers the link', async () => {
    const link = await sharedTrip();
    expect(link).toMatchObject({ id: expect.stringMatching(/^[A-Za-z0-9]{10}$/), owner: true });
    expect(syncStatus.value).toBe('ok');
    expect(await remoteNames(link)).toEqual(Object.keys(toPlain(group.value!)).sort());
    expect((await listGroups())[0].share).toEqual(link);
  });

  it('does nothing without a group, for an already shared one, or when offline', async () => {
    await startSharing();
    expect(syncStatus.value).toBe('off');
    const link = await sharedTrip();
    await startSharing();
    expect(group.value!.share).toBe(link);

    group.value = trip();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    await startSharing();
    expect(syncStatus.value).toBe('offline');
    expect(group.value!.share).toBeUndefined();
  });
});

describe('syncing', () => {
  it('pushes local changes and pulls what others added', async () => {
    const link = await sharedTrip();
    const beto = group.value!.people[1].id;
    group.value = toggleSettled(group.value!, beto);
    await syncNow();

    const taxi = { id: 'taxi', what: 'Taxi', amount: 20, by: beto, at: 2 };
    await pushRemote(link, { 'e:taxi': JSON.stringify(taxi) }, []);
    await syncNow();
    expect(group.value!.expenses.map((expense) => expense.what)).toEqual(['Hotel', 'Taxi']);
    expect(group.value!.people[1].settled).toBe(50);
    expect(syncStatus.value).toBe('ok');
  });

  it('keeps edits made while a sync is running and syncs them right after', async () => {
    const link = await sharedTrip();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await realFetch(input, init);
      if (String(input).includes('since')) group.value = { ...group.value!, title: 'Cusco 2026' };
      return response;
    }) as typeof fetch;
    await syncNow();
    globalThis.fetch = realFetch;
    expect(group.value!.title).toBe('Cusco 2026');
    await syncNow();
    const pulled = await pullRemote(link);
    expect('plain' in pulled && JSON.parse(pulled.plain.m).title).toBe('Cusco 2026');
  });

  it('runs one sync at a time and repeats once when asked meanwhile', async () => {
    await sharedTrip();
    const spy = vi.spyOn(globalThis, 'fetch');
    await Promise.all([syncNow(), syncNow(), syncNow()]);
    const gets = spy.mock.calls.filter(([, init]) => !init?.method);
    expect(gets).toHaveLength(2);
  });

  it('ignores a pull that arrives after switching groups', async () => {
    await sharedTrip();
    const other = newGroup({ title: 'Lima' });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      group.value = other;
      return realFetch(input, init);
    }) as typeof fetch;
    await syncNow();
    expect(group.value).toBe(other);
  });

  it('retries when offline and drops the link when it is gone', async () => {
    const link = await sharedTrip();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    await syncNow();
    expect(syncStatus.value).toBe('offline');

    globalThis.fetch = realFetch;
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(syncStatus.value).toBe('ok'));
    vi.useRealTimers();

    await realFetch(`/api/group/${link.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${link.token}` } });
    await syncNow();
    expect(syncStatus.value).toBe('gone');
    expect(group.value!.share).toBeNull();
    expect(group.value!.expenses).toHaveLength(1);
  });

  it('schedules syncs only for shared groups and syncs when the page is visible', async () => {
    group.value = trip();
    scheduleSync(10);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(syncStatus.value).toBe('off');

    await sharedTrip();
    const spy = vi.spyOn(globalThis, 'fetch');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    syncWhenVisible();
    expect(spy).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    syncWhenVisible();
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
  });
});

describe('joining with the edit link', () => {
  it('downloads the group on a new device and reopens it later', async () => {
    const link = await sharedTrip();
    const ownerGroup = group.value!;
    globalThis.indexedDB = new IDBFactory();
    resetDatabase();
    group.value = null;

    expect(await joinFromHash('#nothing')).toBe(false);
    expect(await joinFromHash(editHash(link))).toBe(true);
    expect(group.value!.id).not.toBe(ownerGroup.id);
    expect(group.value!).toMatchObject({ title: 'Cusco', share: { id: link.id, owner: false } });
    expect(group.value!.people.map((person) => person.name)).toEqual(['Ana', 'Beto']);
    await flush();

    const joinedId = group.value!.id;
    group.value = newGroup();
    await joinFromHash(editHash(link));
    expect(group.value!.id).toBe(joinedId);
  });
});

describe('stop sharing', () => {
  it('deletes the links for everyone when the owner stops', async () => {
    const link = await sharedTrip();
    await stopSharing();
    expect(group.value!.share).toBeNull();
    expect(syncStatus.value).toBe('off');
    await expect(pullRemote(link)).rejects.toMatchObject({ status: 404 });
    await stopSharing();
  });

  it('only forgets the link for a guest, and survives a link that is already gone', async () => {
    const link = await sharedTrip();
    group.value = { ...group.value!, share: { ...link, owner: false } };
    await stopSharing();
    expect(await remoteNames(link)).not.toEqual([]);

    group.value = { ...group.value!, share: { ...link, owner: true, token: 'x'.repeat(32) } };
    await stopSharing();
    expect(group.value!.share).toBeNull();
  });

  it('keeps the link when the network fails', async () => {
    await sharedTrip();
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    await stopSharing();
    expect(group.value!.share).not.toBeNull();
    expect(syncStatus.value).toBe('offline');
  });
});

describe('saved shared groups', () => {
  it('persist the sync baseline so offline edits survive a reload', async () => {
    await sharedTrip();
    await flush();
    const [stored] = await listGroups();
    expect(stored.sync!.fields).toEqual(toPlain(stored));
    await saveGroup({ ...stored, title: 'Offline edit' });
    group.value = (await listGroups())[0];
    await syncNow();
    const pulled = await pullRemote(stored.share!);
    expect('plain' in pulled && JSON.parse(pulled.plain.m).title).toBe('Offline edit');
  });
});
