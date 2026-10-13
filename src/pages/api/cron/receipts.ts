import type { APIRoute } from 'astro';
import { getGroupStore } from '../../../lib/group-store';
import { bearerToken, fail, json, safeEqual } from '../../../lib/http';
import { getReceiptStore } from '../../../lib/receipt-store';
import { sweepReceipts } from '../../../lib/receipt-sweep';
import { readEnv } from '../../../lib/store';

export const prerender = false;

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
export const GET: APIRoute = async ({ request }) => {
  const secret = readEnv('CRON_SECRET');
  if (!secret || !safeEqual(bearerToken(request), secret)) return fail(401, 'unauthorized');
  const receipts = getReceiptStore();
  if (!receipts) return json({ removed: 0, renewed: 0 });
  return json(await sweepReceipts(getGroupStore(), receipts));
};
