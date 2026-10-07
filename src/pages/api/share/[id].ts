import type { APIRoute } from 'astro';
import { canEdit, fail, isId, isPayload, json, MAX_STATE, readJson } from '../../../lib/http';
import { getStore } from '../../../lib/store';

export const prerender = false;

const NOT_FOUND = 'Este link no existe o ya expiró.';

/**
 * Lee un link. Por defecto solo el estado (para refrescar barato);
 * con ?img=1 también la foto. Si llega el token, indica si puede editar.
 */
export const GET: APIRoute = async ({ params, request, url }) => {
  if (!isId(params.id)) return fail(404, NOT_FOUND);
  const withImg = url.searchParams.get('img') === '1';
  const record = await getStore().get(params.id, withImg ? ['state', 'v', 'edit', 'img'] : ['state', 'v', 'edit']);
  if (!record?.state) return fail(404, NOT_FOUND);
  return json({
    state: record.state,
    v: record.v,
    ...(withImg ? { img: record.img } : {}),
    ...(request.headers.has('authorization') ? { canEdit: await canEdit(request, record.edit) } : {}),
  });
};

/** Actualiza los pagos. Requiere el token de edición. */
export const PUT: APIRoute = async ({ params, request }) => {
  if (!isId(params.id)) return fail(404, NOT_FOUND);
  const store = getStore();
  const record = await store.get(params.id, ['edit']);
  if (!record) return fail(404, NOT_FOUND);
  if (!(await canEdit(request, record.edit))) return fail(403, 'Solo el link maestro puede editar.');

  const body = await readJson(request, MAX_STATE + 1_000);
  if (!body || !isPayload(body.state, MAX_STATE)) return fail(400, 'Datos inválidos.');
  const v = await store.updateState(params.id, body.state);
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
