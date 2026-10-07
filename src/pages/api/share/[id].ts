import type { APIRoute } from 'astro';
import { canEdit, fail, isId, isOptionalPayload, isPayload, json, MAX_PAY, MAX_STATE, readJson } from '../../../lib/http';
import type { ShareRecord } from '../../../lib/store';
import { getStore } from '../../../lib/store';

export const prerender = false;

const NOT_FOUND = 'Este link no existe o ya expiró.';

type Field = keyof ShareRecord;

/** Qué campos leer: el estado siempre; la foto con ?img=1; los datos para pagar con ?img=1 o ?pay=1. */
function fieldsFor(url: URL): { fields: Field[]; img: boolean; pay: boolean } {
  const img = url.searchParams.get('img') === '1';
  const pay = img || url.searchParams.get('pay') === '1';
  const fields: Field[] = ['state', 'v', 'pv', 'edit'];
  if (img) fields.push('img');
  if (pay) fields.push('pay');
  return { fields, img, pay };
}

/**
 * Lee un link. Por defecto solo el estado y versiones (para refrescar barato).
 * Si llega el token, indica si puede editar.
 */
export const GET: APIRoute = async ({ params, request, url }) => {
  if (!isId(params.id)) return fail(404, NOT_FOUND);
  const want = fieldsFor(url);
  const record = await getStore().get(params.id, want.fields);
  if (!record?.state) return fail(404, NOT_FOUND);
  const access = request.headers.has('authorization') ? { canEdit: await canEdit(request, record.edit) } : {};
  return json({ ...publicFields(record, want), ...access });
};

/** Lo que se devuelve sin token: estado, versiones y, si se pidieron, foto y datos para pagar. */
function publicFields(record: Partial<ShareRecord>, want: { img: boolean; pay: boolean }) {
  return {
    state: record.state,
    v: record.v,
    pv: record.pv ?? 0,
    ...(want.img ? { img: record.img } : {}),
    ...(want.pay && record.pay ? { pay: record.pay } : {}),
  };
}

/** Actualiza los pagos. Requiere el token de edición. */
export const PUT: APIRoute = async ({ params, request }) => {
  if (!isId(params.id)) return fail(404, NOT_FOUND);
  const store = getStore();
  const record = await store.get(params.id, ['edit']);
  if (!record) return fail(404, NOT_FOUND);
  if (!(await canEdit(request, record.edit))) return fail(403, 'Solo el link maestro puede editar.');

  const body = await readJson(request, MAX_STATE + MAX_PAY + 1_000);
  if (!body || !isPayload(body.state, MAX_STATE) || !isOptionalPayload(body.pay, MAX_PAY)) return fail(400, 'Datos inválidos.');
  const v = await store.updateState(params.id, body.state, body.pay as string | undefined);
  return json({ v });
};

/** Deja de compartir: borra el link. Requiere el token de edición. */
export const DELETE: APIRoute = async ({ params, request }) => {
  if (!isId(params.id)) return fail(404, NOT_FOUND);
  const store = getStore();
  const record = await store.get(params.id, ['edit']);
  if (!record) return json({ ok: true });
  if (!(await canEdit(request, record.edit))) return fail(403, 'Solo el link maestro puede borrar.');
  await store.remove(params.id);
  return json({ ok: true });
};
