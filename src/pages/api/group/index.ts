import type { APIRoute } from 'astro';
import { getGroupStore } from '../../../lib/group-store';
import { isFields, MAX_GROUP_BODY } from '../../../lib/group-http';
import { fail, json, randomId, randomToken, readJson, sha256 } from '../../../lib/http';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request, MAX_GROUP_BODY);
  if (!body) return fail(413, 'too_large');
  if (!isFields(body.fields) || !('m' in body.fields)) return fail(400, 'invalid');

  const id = randomId();
  const token = randomToken();
  await getGroupStore().create(id, await sha256(token), body.fields);
  return json({ id, token, v: 1 }, 201);
};
