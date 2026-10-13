import type { APIRoute } from 'astro';
import { getGroupStore } from '../../../../../lib/group-store';
import { canEdit, fail, isId, isPayload, json, readJson } from '../../../../../lib/http';
import { getReceiptStore, isExpenseId, MAX_RECEIPT, receiptPath } from '../../../../../lib/receipt-store';

export const prerender = false;

const NOT_FOUND = 'not_found';
const UNAVAILABLE = 'unavailable';

type Params = Record<string, string | undefined>;

const isTarget = (params: Params) => isId(params.id) && isExpenseId(params.expense);
const pathOf = (params: Params) => receiptPath(params.id!, params.expense!);

async function editable(params: Params, request: Request): Promise<Response | null> {
  if (!isTarget(params)) return fail(404, NOT_FOUND);
  const record = await getGroupStore().get(params.id!);
  if (!record) return fail(404, NOT_FOUND);
  return (await canEdit(request, record.edit)) ? null : fail(403, 'forbidden');
}

export const GET: APIRoute = async ({ params }) => {
  if (!isTarget(params)) return fail(404, NOT_FOUND);
  const receipts = getReceiptStore();
  if (!receipts) return fail(503, UNAVAILABLE);
  if ((await getGroupStore().version(params.id!)) == null) return fail(404, NOT_FOUND);
  const data = await receipts.get(pathOf(params)).catch(() => undefined);
  if (data === undefined) return fail(503, UNAVAILABLE);
  return data ? json({ data }) : fail(404, NOT_FOUND);
};

export const PUT: APIRoute = async ({ params, request }) => {
  const denied = await editable(params, request);
  if (denied) return denied;
  const receipts = getReceiptStore();
  if (!receipts) return fail(503, UNAVAILABLE);
  const body = await readJson(request, MAX_RECEIPT + 100);
  if (!isPayload(body?.data, MAX_RECEIPT)) return fail(400, 'invalid');
  try {
    await receipts.put(pathOf(params), body.data);
    await getGroupStore().trackReceipts(params.id!);
  } catch {
    return fail(503, UNAVAILABLE);
  }
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const denied = await editable(params, request);
  if (denied) return denied;
  await getReceiptStore()
    ?.remove(pathOf(params))
    .catch(() => undefined);
  return json({ ok: true });
};
