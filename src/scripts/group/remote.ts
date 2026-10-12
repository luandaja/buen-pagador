import { importKey, newKey } from '../crypto';
import { expiresAtFrom } from '../links';
import { request } from '../share';
import { decryptFields, encryptFields, type Plain } from './codec';
import type { GroupLink } from './model';

export type Pulled = ({ v: number; plain: Plain; canEdit?: boolean } | { v: number; unchanged: true }) & { expiresAt?: number };

type RawGroup = { v: number; fields?: Plain; unchanged?: boolean; canEdit?: boolean; ttl?: number };

export const GROUP_PUBLIC_PATH = '/c';
const GROUP_EDIT_PATH = '/cuenta';

export const groupPublicUrl = (link: Pick<GroupLink, 'id' | 'key'>) => `${location.origin}${GROUP_PUBLIC_PATH}#${link.id}.${link.key}`;
export const groupEditUrl = (link: GroupLink) => `${location.origin}${GROUP_EDIT_PATH}#edit=${link.id}.${link.key}.${link.token}`;

export async function createRemote(plain: Plain): Promise<{ link: GroupLink; v: number }> {
  const { key, raw } = await newKey();
  const fields = await encryptFields(key, plain);
  const created = await request<{ id: string; token: string; v: number; ttl?: number }>('/api/group', { method: 'POST', body: JSON.stringify({ fields }) });
  return { link: { id: created.id, key: raw, token: created.token, owner: true, expiresAt: expiresAtFrom(created.ttl) }, v: created.v };
}

export async function pushRemote(link: GroupLink, set: Plain, del: string[]): Promise<number> {
  const fields = await encryptFields(await importKey(link.key), set);
  const updated = await request<{ v: number }>(`/api/group/${link.id}`, { method: 'PATCH', body: JSON.stringify({ set: fields, del }) }, link.token);
  return updated.v;
}

export async function pullRemote(link: Pick<GroupLink, 'id' | 'key'> & { token?: string }, since?: number): Promise<Pulled> {
  const query = since ? `?since=${since}` : '';
  const raw = await request<RawGroup>(`/api/group/${link.id}${query}`, {}, link.token);
  const expiresAt = expiresAtFrom(raw.ttl);
  if (raw.unchanged) return { v: raw.v, unchanged: true, expiresAt };
  return { v: raw.v, plain: await decryptFields(await importKey(link.key), raw.fields ?? {}), canEdit: raw.canEdit, expiresAt };
}

export async function deleteRemote(link: GroupLink): Promise<void> {
  await request(`/api/group/${link.id}`, { method: 'DELETE' }, link.token);
}
