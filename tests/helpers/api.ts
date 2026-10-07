import type { APIContext } from 'astro';
import * as item from '../../src/pages/api/share/[id]';
import * as collection from '../../src/pages/api/share/index';

type Handler = (ctx: APIContext) => Response | Promise<Response>;

export async function callApi(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input, 'http://localhost');
  const method = (init.method ?? 'GET').toUpperCase();
  const request = new Request(url, { ...init, method });
  const match = /^\/api\/share(?:\/([^/]+))?$/.exec(url.pathname);
  if (!match) return new Response('not found', { status: 404 });
  const routes = (match[1] ? item : collection) as unknown as Record<string, Handler | undefined>;
  const handler = routes[method];
  if (!handler) return new Response('method not allowed', { status: 405 });
  return handler({ request, url, params: { id: match[1] } } as unknown as APIContext);
}

export function useApiFetch() {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => callApi(String(input), init)) as typeof fetch;
}
