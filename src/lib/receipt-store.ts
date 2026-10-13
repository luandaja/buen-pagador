import { del, get, list, put } from '@vercel/blob';
import { readEnv } from './store';

// Receipt photos arrive already encrypted with the group key; the store only sees ciphertext.
export interface ReceiptStore {
  put(path: string, data: string): Promise<void>;
  get(path: string): Promise<string | null>;
  remove(path: string): Promise<void>;
  removeFolder(prefix: string): Promise<void>;
}

export const MAX_RECEIPT = 1_200_000;

const EXPENSE_ID = /^[a-z0-9]{1,16}$/;

export const isExpenseId = (value: unknown): value is string => typeof value === 'string' && EXPENSE_ID.test(value);
export const receiptFolder = (groupId: string) => `receipts/${groupId}/`;
export const receiptPath = (groupId: string, expenseId: string) => `${receiptFolder(groupId)}${expenseId}.txt`;

const ACCESS = 'private';

class VercelBlobReceiptStore implements ReceiptStore {
  async put(path: string, data: string) {
    await put(path, data, { access: ACCESS, allowOverwrite: true, addRandomSuffix: false, contentType: 'text/plain' });
  }

  async get(path: string) {
    const found = await get(path, { access: ACCESS, useCache: false });
    return found?.statusCode === 200 ? new Response(found.stream).text() : null;
  }

  async remove(path: string) {
    await del(path);
  }

  async removeFolder(prefix: string) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor });
      if (page.blobs.length) await del(page.blobs.map((blob) => blob.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
}

class MemoryReceiptStore implements ReceiptStore {
  private data: Map<string, string>;

  constructor() {
    const globalScope = globalThis as unknown as { __bpReceipts?: Map<string, string> };
    this.data = globalScope.__bpReceipts ??= new Map();
  }

  async put(path: string, data: string) {
    this.data.set(path, data);
  }

  async get(path: string) {
    return this.data.get(path) ?? null;
  }

  async remove(path: string) {
    this.data.delete(path);
  }

  async removeFolder(prefix: string) {
    for (const path of [...this.data.keys()]) if (path.startsWith(prefix)) this.data.delete(path);
  }
}

const hasBlob = () => !!(readEnv('BLOB_READ_WRITE_TOKEN') || readEnv('BLOB_STORE_ID'));

// Without Blob in production, shared receipts are simply off: the photo stays on the device that took it.
function createReceiptStore(isDev: boolean): ReceiptStore | null {
  if (hasBlob()) return new VercelBlobReceiptStore();
  return isDev ? new MemoryReceiptStore() : null;
}

let store: ReceiptStore | null | undefined;

export function getReceiptStore(): ReceiptStore | null {
  if (store === undefined) store = createReceiptStore(import.meta.env.DEV);
  return store;
}

export function resetReceiptStore() {
  store = undefined;
  delete (globalThis as { __bpReceipts?: unknown }).__bpReceipts;
}

export { MemoryReceiptStore, VercelBlobReceiptStore };
