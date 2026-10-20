import { randomBytes } from 'node:crypto';

// Crockford base32, ULID layout: 48-bit millisecond timestamp + 80 random bits.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid(now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(10);
  let bits = 0;
  let value = 0;
  let random = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      random += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return time + random;
}

/** Time-sortable identifier such as `ft_01J9Z...`. */
export function newId(prefix: 'ft' | 'cm' | 'dk'): string {
  return `${prefix}_${ulid().toLowerCase()}`;
}

export const SLUG = /^[a-z][a-z0-9-]{1,60}$/;
export const USERNAME = /^[a-z][a-z0-9_]{2,31}$/;
export const VEHICLE_MODEL_ID = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
export const GROUP_CODE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
export const FEATURE_NAME = /^[a-z][a-z0-9_-]{2,45}$/;
