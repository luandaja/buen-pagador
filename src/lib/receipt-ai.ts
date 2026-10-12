import { normalizeParsed, parseJsonReply, type ParsedReceipt } from '../scripts/group/receipt';
import { readEnv } from './store';

export const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
export const PROVIDER_TIMEOUT_MS = 25_000;
const MAX_OUTPUT_TOKENS = 900;

export const RECEIPT_PROMPT = `Lee esta boleta o cuenta de restaurante y responde SOLO con JSON válido, sin texto extra, con esta forma:
{"merchant": string, "items": [{"name": string, "quantity": number, "unitPrice": number, "amount": number}], "charges": number, "discount": number, "tip": number, "total": number}
Reglas:
- "amount" es el importe total de la línea (cantidad × precio unitario), no el precio unitario.
- Las boletas tienen formatos distintos: la cantidad puede ir antes o después del nombre, y el importe puede estar en otra línea. Usa la columna de importe o total de cada línea.
- Incluye cada producto consumido. No incluyas como ítems subtotales, impuestos (IGV), recargos, servicio, descuentos ni totales.
- "charges" suma los impuestos, servicio o recargos que se agregan APARTE de los precios de los ítems (0 si los precios ya los incluyen).
- "discount" suma los descuentos (número positivo, 0 si no hay).
- "tip" es la propina (0 si no hay).
- "total" es el total final que se pagó, incluida la propina. Nunca es menor que la suma de los ítems.
- Si un nombre ocupa dos líneas, únelas en un solo nombre.
- Usa punto como separador decimal.
- No incluyas datos personales (nombre del cliente, DNI, RUC, tarjeta).`;

export type ReceiptFailure = 'unavailable' | 'quota' | 'failed';

export class ReceiptAiError extends Error {
  constructor(public reason: ReceiptFailure) {
    super(reason);
  }
}

type Fetch = typeof fetch;

interface Provider {
  name: string;
  keyName: string;
  request(key: string, image: string): { url: string; init: RequestInit };
  text(reply: unknown): string;
}

const groq: Provider = {
  name: 'groq',
  keyName: 'GROQ_API_KEY',
  request: (key, image) => ({
    url: 'https://api.groq.com/openai/v1/chat/completions',
    init: {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: readEnv('GROQ_RECEIPT_MODEL') || DEFAULT_GROQ_MODEL,
        temperature: 0,
        max_tokens: MAX_OUTPUT_TOKENS,
        reasoning_effort: 'none',
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: [{ type: 'text', text: RECEIPT_PROMPT }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } }] }],
      }),
    },
  }),
  text: (reply) => (reply as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? '',
};

const gemini: Provider = {
  name: 'gemini',
  keyName: 'GEMINI_API_KEY',
  request: (key, image) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${readEnv('GEMINI_RECEIPT_MODEL') || DEFAULT_GEMINI_MODEL}:generateContent`,
    init: {
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: RECEIPT_PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: image } }] }],
        generationConfig: { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: 'application/json' },
      }),
    },
  }),
  text: (reply) =>
    (reply as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }).candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text ?? '')
      .join('') ?? '',
};

export const PROVIDERS = [groq, gemini];

async function readWith(provider: Provider, key: string, image: string, fetcher: Fetch): Promise<ParsedReceipt> {
  const { url, init } = provider.request(key, image);
  let response: Response;
  try {
    response = await fetcher(url, { ...init, method: 'POST', signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  } catch {
    throw new ReceiptAiError('failed');
  }
  if (response.status === 429) throw new ReceiptAiError('quota');
  if (!response.ok) throw new ReceiptAiError('failed');
  const parsed = normalizeParsed(parseJsonReply(provider.text(await response.json())));
  if (!parsed.items.length) throw new ReceiptAiError('failed');
  return parsed;
}

export async function readReceiptWithAi(image: string, fetcher: Fetch = fetch, providers = PROVIDERS): Promise<ParsedReceipt & { provider: string }> {
  let failure: ReceiptFailure = 'unavailable';
  for (const provider of providers) {
    const key = readEnv(provider.keyName);
    if (!key) continue;
    try {
      return { ...(await readWith(provider, key, image, fetcher)), provider: provider.name };
    } catch (error) {
      failure = (error as ReceiptAiError).reason;
    }
  }
  throw new ReceiptAiError(failure);
}
