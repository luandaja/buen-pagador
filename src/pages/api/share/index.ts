import type { APIRoute } from 'astro';
import { fail, isOptionalPayload, isPayload, json, MAX_IMG, MAX_PAY, MAX_STATE, randomId, randomToken, readJson, sha256 } from '../../../lib/http';
import { getStore } from '../../../lib/store';

export const prerender = false;

/** Crea un link compartido. Devuelve el id público y el token de edición. */
export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request, MAX_IMG + MAX_STATE + MAX_PAY + 1_000);
  if (!body) return fail(413, 'La foto es demasiado grande o el cuerpo no es válido.');
  const { img, state, pay } = body;
  const valid = isPayload(img, MAX_IMG) && isPayload(state, MAX_STATE) && isOptionalPayload(pay, MAX_PAY);
  if (!valid) return fail(400, 'Datos inválidos.');

  const id = randomId();
  const token = randomToken();
  await getStore().create(id, { img, state, edit: await sha256(token), v: 1, ...(pay ? { pay: pay as string, pv: 1 } : {}) });
  return json({ id, token, v: 1 }, 201);
};
