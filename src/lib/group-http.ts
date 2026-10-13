import { isPayload } from './http';
import type { Fields } from './group-store';

export const MAX_FIELD = 8_000;
export const MAX_QR = 300_000;
export const MAX_FIELDS = 500;
export const MAX_GROUP_BODY = MAX_FIELDS * (MAX_FIELD + 40) + MAX_QR;

const FIELD_NAME = /^(?:m|q|[pe]:[a-z0-9]{1,16})$/;

const maxLengthOf = (name: string) => (name === 'q' ? MAX_QR : MAX_FIELD);

export const isFieldName = (name: unknown): name is string => typeof name === 'string' && FIELD_NAME.test(name);

export function isFields(value: unknown): value is Fields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_FIELDS && entries.every(([name, payload]) => isFieldName(name) && isPayload(payload, maxLengthOf(name)));
}

export function isFieldList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_FIELDS && value.every(isFieldName);
}

export function parsePatch(body: Record<string, unknown> | null): { set: Fields; del: string[] } | null {
  if (!body) return null;
  const { set = {}, del = [] } = body;
  if (!isFields(set) || !isFieldList(del) || del.includes('m')) return null;
  return { set, del };
}
