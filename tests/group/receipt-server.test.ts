// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { APIContext } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryLimiter, RedisLimiter, getLimiter, resetLimiter } from '../../src/lib/rate-limit';
import { DEFAULT_GROQ_MODEL, readReceiptWithAi, ReceiptAiError } from '../../src/lib/receipt-ai';
import { MAX_RECEIPT_IMAGE, POST, RECEIPTS_PER_HOUR } from '../../src/pages/api/receipt';

const aiReply = readFileSync(resolve('tests/fixtures/receipt-ai.json'), 'utf8');
const geminiReply = (text: string, status = 200) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n' }, { text }, { text: '\n```' }] } }] }), { status });

beforeEach(() => resetLimiter());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const groqReply = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }));

describe('reading receipts with AI', () => {
  it('asks Groq first with the image and a capped answer', async () => {
    vi.stubEnv('GROQ_API_KEY', 'groq-key');
    vi.stubEnv('GEMINI_API_KEY', 'gemini-key');
    const fetcher = vi.fn(async () => groqReply(aiReply));
    const parsed = await readReceiptWithAi('QUJD', fetcher as unknown as typeof fetch);
    expect(parsed).toMatchObject({ provider: 'groq', total: 497.09, tip: 45.19 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer groq-key');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: DEFAULT_GROQ_MODEL, max_tokens: 1000, response_format: { type: 'json_object' } });
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/jpeg;base64,QUJD');
  });

  it('falls back to Gemini when Groq has no quota, fails or is not configured', async () => {
    vi.stubEnv('GROQ_API_KEY', 'groq-key');
    vi.stubEnv('GEMINI_API_KEY', 'gemini-key');
    vi.stubEnv('GEMINI_RECEIPT_MODEL', 'gemini-test');
    const fetcher = vi.fn(async (url: string) => (url.includes('groq') ? new Response('{}', { status: 429 }) : geminiReply(aiReply)));
    const parsed = await readReceiptWithAi('QUJD', fetcher as unknown as typeof fetch);
    expect(parsed.provider).toBe('gemini');
    const [url, init] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain('/models/gemini-test:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('gemini-key');
    expect(JSON.parse(init.body as string).contents[0].parts[1].inline_data).toEqual({ mime_type: 'image/jpeg', data: 'QUJD' });

    vi.stubEnv('GROQ_API_KEY', '');
    expect((await readReceiptWithAi('QUJD', fetcher as unknown as typeof fetch)).provider).toBe('gemini');
  });

  it('skips thinking parts of the Gemini answer', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k');
    const reply = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'pensando { no }', thought: true }, { text: aiReply }] } }] }));
    expect((await readReceiptWithAi('QUJD', (async () => reply) as unknown as typeof fetch)).items).toHaveLength(14);
  });

  it('explains why it could not read', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    await expect(readReceiptWithAi('QUJD')).rejects.toMatchObject({ reason: 'unavailable' });
    vi.stubEnv('GEMINI_API_KEY', 'k');
    const reply = (response: () => Promise<Response>) => readReceiptWithAi('QUJD', response as unknown as typeof fetch);
    await expect(reply(async () => new Response('{}', { status: 429 }))).rejects.toMatchObject({ reason: 'quota' });
    await expect(reply(async () => new Response('{}', { status: 500 }))).rejects.toMatchObject({ reason: 'failed' });
    await expect(reply(async () => geminiReply('no hay items'))).rejects.toMatchObject({ reason: 'failed' });
    await expect(reply(async () => new Response('{}'))).rejects.toBeInstanceOf(ReceiptAiError);
    await expect(
      reply(async () => {
        throw new DOMException('timeout', 'TimeoutError');
      }),
    ).rejects.toMatchObject({ reason: 'failed' });
  });
});

describe('rate limits', () => {
  it('counts hits per window in memory', async () => {
    vi.useFakeTimers();
    const limiter = new MemoryLimiter();
    expect(await limiter.hit('a', 60)).toBe(1);
    expect(await limiter.hit('a', 60)).toBe(2);
    vi.advanceTimersByTime(61_000);
    expect(await limiter.hit('a', 60)).toBe(1);
    vi.useRealTimers();
  });

  it('uses Redis INCR with a one-time expiry', async () => {
    const transaction = { incr: vi.fn(), expire: vi.fn(), exec: vi.fn(async () => [3, 1]) };
    const limiter = new RedisLimiter({ multi: () => transaction } as never);
    expect(await limiter.hit('k', 3600)).toBe(3);
    expect(transaction.expire).toHaveBeenCalledWith('k', 3600, 'NX');
  });

  it('picks Redis when credentials exist', () => {
    expect(getLimiter()).toBeInstanceOf(MemoryLimiter);
    resetLimiter();
    vi.stubEnv('KV_REST_API_URL', 'https://kv');
    vi.stubEnv('KV_REST_API_TOKEN', 'tok');
    expect(getLimiter()).toBeInstanceOf(RedisLimiter);
    expect(getLimiter()).toBe(getLimiter());
  });
});

describe('POST /api/receipt', () => {
  const call = (body: unknown, headers: Record<string, string> = {}, address?: string) => {
    const request = new Request('http://localhost/api/receipt', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers });
    const context = { request } as unknown as APIContext;
    Object.defineProperty(context, 'clientAddress', {
      get: () => {
        if (!address) throw new Error('no address');
        return address;
      },
    });
    return POST(context);
  };

  it('returns the items read by the AI', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn(async () => geminiReply(aiReply)));
    const response = await call({ image: 'QUJD' }, {}, '1.2.3.4');
    expect(response.status).toBe(200);
    expect((await response.json()).total).toBe(497.09);
  });

  it('rejects bad images and says when the AI is unavailable', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    expect((await call({ image: 'not base64!' })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect((await call('x'.repeat(MAX_RECEIPT_IMAGE + 200))).status).toBe(413);
    const unavailable = await call({ image: 'QUJD' });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: 'unavailable' });
  });

  it('maps unexpected failures and limits each client per hour', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network');
    }));
    expect((await call({ image: 'QUJD' }, { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' })).status).toBe(502);
    for (let index = 1; index < RECEIPTS_PER_HOUR; index++) await call({ image: 'QUJD' }, { 'x-forwarded-for': '9.9.9.9' });
    expect((await call({ image: 'QUJD' }, { 'x-forwarded-for': '9.9.9.9' })).status).toBe(429);
    expect((await call({ image: 'QUJD' }, { 'x-forwarded-for': '8.8.8.8' })).status).toBe(502);
  });
});
