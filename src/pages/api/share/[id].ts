import type { APIRoute } from 'astro';
import { canEdit, fail, isId, isOptionalPayload, isPayload, json, MAX_PAY, MAX_STATE, readJson } from '../../../lib/http';
import type { ShareRecord } from '../../../lib/store';
import { getStore } from '../../../lib/store';

export const prerender = false;

const NOT_FOUND = 'not_found';

type Field = keyof ShareRecord;

type Requested = { fields: Field[]; image: boolean; pay: boolean };

function fieldsFor(url: URL): Requested {
  const image = url.searchParams.get('img') === '1';
  const pay = image || url.searchParams.get('pay') === '1';
  const fields: Field[] = ['state', 'v', 'pv', 'edit'];
  if (image) fields.push('img');
  if (pay) fields.push('pay');
  return { fields, image, pay };
}

export const GET: APIRoute = async ({ params, request, url }) => {
  if (!isId(params.id)) return fail(404, NOT_FOUND);
  const requested = fieldsFor(url);
  const record = await getStore().get(params.id, requested.fields);
  if (!record?.state) return fail(404, NOT_FOUND);
  const access = request.headers.has('authorization') ? { canEdit: await canEdit(request, record.edit) } : {};
  return json({ ...publicFields(record, requested), ...access });
};

function publicFields(record: Partial<ShareRecord>, requested: Requested) {
  return {
    state: record.state,
    v: record.v,
    pv: record.pv ?? 0,
    ...(requested.image ? { img: record.img } : {}),
    ...(requested.pay && record.pay ? { pay: record.pay } : {}),
  };
}

export const PUT: APIRoute = async ({ params, request }) => {
  if (!isId(params.id)) return fail(404, NOT_FOUND);
  const store = getStore();
  const record = await store.get(params.id, ['edit']);
  if (!record) return fail(404, NOT_FOUND);
  if (!(await canEdit(request, record.edit))) return fail(403, 'forbidden');

  const body = await readJson(request, MAX_STATE + MAX_PAY + 1_000);
  if (!body || !isPayload(body.state, MAX_STATE) || !isOptionalPayload(body.pay, MAX_PAY)) return fail(400, 'invalid');
  const version = await store.updateState(params.id, body.state, body.pay as string | undefined);
  return json({ v: version });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  if (!isId(params.id)) return fail(404, NOT_FOUND);
  const store = getStore();
  const record = await store.get(params.id, ['edit']);
  if (!record) return json({ ok: true });
  if (!(await canEdit(request, record.edit))) return fail(403, 'forbidden');
  await store.remove(params.id);
  return json({ ok: true });
};
