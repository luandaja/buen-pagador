import type { APIRoute } from 'astro';
import { getGroupStore, GROUP_TTL_SECONDS } from '../../../lib/group-store';
import { MAX_GROUP_BODY, parsePatch } from '../../../lib/group-http';
import { canEdit, fail, isId, json, readJson } from '../../../lib/http';

export const prerender = false;

const NOT_FOUND = 'not_found';

export const GET: APIRoute = async ({ params, request, url }) => {
  if (!isId(params.id)) return fail(404, NOT_FOUND);
  const store = getGroupStore();
  const since = Number(url.searchParams.get('since'));
  const ttl = (await store.ttl(params.id)) ?? undefined;
  if (since && (await store.version(params.id)) === since) return json({ v: since, unchanged: true, ttl });
  const record = await store.get(params.id);
  if (!record) return fail(404, NOT_FOUND);
  const access = request.headers.has('authorization') ? { canEdit: await canEdit(request, record.edit) } : {};
  return json({ fields: record.fields, v: record.v, ttl, ...access });
};

export const PATCH: APIRoute = async ({ params, request }) => {
  if (!isId(params.id)) return fail(404, NOT_FOUND);
  const store = getGroupStore();
  const record = await store.get(params.id);
  if (!record) return fail(404, NOT_FOUND);
  if (!(await canEdit(request, record.edit))) return fail(403, 'forbidden');

  const patch = parsePatch(await readJson(request, MAX_GROUP_BODY));
  if (!patch) return fail(400, 'invalid');
  return json({ v: await store.patch(params.id, patch.set, patch.del), ttl: GROUP_TTL_SECONDS });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  if (!isId(params.id)) return fail(404, NOT_FOUND);
  const store = getGroupStore();
  const record = await store.get(params.id);
  if (!record) return json({ ok: true });
  if (!(await canEdit(request, record.edit))) return fail(403, 'forbidden');
  await store.remove(params.id);
  return json({ ok: true });
};
