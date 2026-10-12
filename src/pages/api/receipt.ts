import type { APIRoute } from 'astro';
import { fail, json, readJson } from '../../lib/http';
import { getLimiter } from '../../lib/rate-limit';
import { readReceiptWithAi, ReceiptAiError } from '../../lib/receipt-ai';

export const prerender = false;

export const MAX_RECEIPT_IMAGE = 4_000_000;
export const RECEIPTS_PER_HOUR = 20;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const STATUS = { unavailable: 503, quota: 503, failed: 502 };

const clientOf = (request: Request, address: string | undefined) => request.headers.get('x-forwarded-for')?.split(',')[0].trim() || address || 'local';

function clientAddress(locals: () => string): string | undefined {
  try {
    return locals();
  } catch {
    return undefined;
  }
}

export const POST: APIRoute = async (context) => {
  const { request } = context;
  const body = await readJson(request, MAX_RECEIPT_IMAGE + 100);
  if (!body) return fail(413, 'too_large');
  const { image } = body;
  if (typeof image !== 'string' || !image || image.length > MAX_RECEIPT_IMAGE || !BASE64.test(image)) return fail(400, 'invalid');

  const client = clientOf(request, clientAddress(() => context.clientAddress));
  const hits = await getLimiter().hit(`bp:rl:receipt:${client}`, 3600);
  if (hits > RECEIPTS_PER_HOUR) return fail(429, 'rate_limited');

  try {
    return json(await readReceiptWithAi(image));
  } catch (error) {
    const reason = error instanceof ReceiptAiError ? error.reason : 'failed';
    return fail(STATUS[reason], reason);
  }
};
