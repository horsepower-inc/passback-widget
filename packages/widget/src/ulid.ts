// Batch.id is a ULID, dependency-free (widget ships no runtime deps).

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

function encodeRandom(bytes: Uint8Array): string {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let chars = '';
  for (let i = 0; i < RANDOM_CHARS; i++) {
    chars += ALPHABET[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  }
  return chars;
}

/** Generates a ULID: 10 Crockford base32 chars of the millisecond time, then 16 of 80 random bits. */
export function newUlid(
  now: number = Date.now(),
  random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  return encodeTime(now) + encodeRandom(random(10));
}
