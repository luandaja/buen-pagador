import type { APIContext } from 'astro';
import * as cronReceipts from '../../src/pages/api/cron/receipts';
import * as groupItem from '../../src/pages/api/group/[id]';
import * as groupReceipt from '../../src/pages/api/group/[id]/receipt/[expense]';
import * as groupCollection from '../../src/pages/api/group/index';
import * as item from '../../src/pages/api/share/[id]';
import * as collection from '../../src/pages/api/share/index';

type Handler = (ctx: APIContext) => Response | Promise<Response>;

function dispatch(module: unknown, method: string, context: { request: Request; url: URL; params: Record<string, string> }) {
  const handler = (module as Record<string, Handler | undefined>)[method];
  if (!handler) return new Response('method not allowed', { status: 405 });
  return handler(context as unknown as APIContext);
}

export async function callApi(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input, 'http://localhost');
  const method = (init.method ?? 'GET').toUpperCase();
  const request = new Request(url, { ...init, method });
  const receipt = /^\/api\/group\/([^/]+)\/receipt\/([^/]+)$/.exec(url.pathname);
  if (receipt) return dispatch(groupReceipt, method, { request, url, params: { id: receipt[1], expense: receipt[2] } });
  if (url.pathname === '/api/cron/receipts') return dispatch(cronReceipts, method, { request, url, params: {} });
  const match = /^\/api\/(share|group)(?:\/([^/]+))?$/.exec(url.pathname);
  if (!match) return new Response('not found', { status: 404 });
  const modules = match[1] === 'share' ? [item, collection] : [groupItem, groupCollection];
  const routes = (match[2] ? modules[0] : modules[1]) as unknown as Record<string, Handler | undefined>;
  const handler = routes[method];
  if (!handler) return new Response('method not allowed', { status: 405 });
  return handler({ request, url, params: { id: match[2] } } as unknown as APIContext);
}

export function useApiFetch() {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => callApi(String(input), init)) as typeof fetch;
}
