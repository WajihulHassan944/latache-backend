import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * CMI "ver3" request/response signature (3D Pay Hosting):
 * 1. take every posted field except HASH and encoding,
 * 2. sort the field names case-insensitively, ascending,
 * 3. escape each value (backslash -> double backslash, pipe -> backslash-pipe) and join with "|",
 * 4. append "|" + escaped store key,
 * 5. base64(SHA-512 raw digest).
 */
const EXCLUDED = new Set(['hash', 'encoding']);

const escapeValue = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

export function cmiHash(fields: Record<string, unknown>, storeKey: string): string {
  const keys = Object.keys(fields)
    .filter((key) => !EXCLUDED.has(key.toLowerCase()))
    .sort((a, b) => {
      const left = a.toLowerCase();
      const right = b.toLowerCase();
      return left < right ? -1 : left > right ? 1 : 0;
    });
  const plain = [
    ...keys.map((key) => escapeValue(String(fields[key] ?? '').trim())),
    escapeValue(storeKey),
  ].join('|');
  return createHash('sha512').update(plain, 'utf8').digest('base64');
}

export function cmiHashMatches(fields: Record<string, unknown>, storeKey: string): boolean {
  const received = String(fields.HASH ?? fields.hash ?? '');
  if (!received) return false;
  const expected = cmiHash(fields, storeKey);
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
