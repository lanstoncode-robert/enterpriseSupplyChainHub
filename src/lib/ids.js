import { createHash, randomBytes } from 'node:crypto';

export const GENESIS_HASH = 'GENESIS';

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function randomId(prefix = '') {
  return `${prefix}${randomBytes(8).toString('base64url')}`;
}

/** Deterministic JSON: object keys sorted recursively, suitable for hashing. */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
