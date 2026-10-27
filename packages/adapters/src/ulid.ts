// a dependency-free ULID generator (Crockford base32).

import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;

function encodeTime(time: number): string {
  let chars = '';
  let remaining = time;
  for (let i = 0; i < TIME_CHARS; i++) {
    chars = ALPHABET[remaining % 32] + chars;
    remaining = Math.floor(remaining / 32);
  }
  return chars;
}

function encodeRandom(bytes: Buffer): string {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let chars = '';
  for (let i = 0; i < RANDOM_CHARS; i++) {
    chars += ALPHABET[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  }
  return chars;
}

/** Generates a ULID: 10 Crockford base32 chars of the millisecond time, then 16 of 80 random bits. */
export function ulid(time: number = Date.now()): string {
  return encodeTime(time) + encodeRandom(randomBytes(10));
}
