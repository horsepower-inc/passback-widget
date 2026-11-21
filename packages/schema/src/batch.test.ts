import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_BATCH_MARKS, parseBatch } from './index';

const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
const marks = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(dir + f, 'utf8')) as unknown);

const ulid = '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8';

const REVIEW = 'abcdefghijklmnopqrstuvwxyz';

function batch(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: ulid,
    createdAt: '2026-09-19T14:00:00Z',
    marks,
    ...overrides,
  };
}

describe('parseBatch', () => {
  it('parses a batch built from the fixtures/payloads/*.json files', () => {
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(() => parseBatch(batch())).not.toThrow();
  });

  it('rejects a batch with 0 marks', () => {
    expect(() => parseBatch(batch({ marks: [] }))).toThrow();
  });

  it(`rejects a batch with more than ${MAX_BATCH_MARKS} marks`, () => {
    const tooMany = Array.from({ length: MAX_BATCH_MARKS + 1 }, () => marks[0]);
    expect(() => parseBatch(batch({ marks: tooMany }))).toThrow();
  });

  it('rejects a non-ULID id', () => {
    expect(() => parseBatch(batch({ id: 'not-a-ulid' }))).toThrow();
    expect(() => parseBatch(batch({ id: ulid.toLowerCase() }))).toThrow();
    expect(() => parseBatch(batch({ id: '80000000000000000000000000' }))).toThrow();
  });

  it('accepts a batch with a pull request number', () => {
    expect(parseBatch(batch({ pullRequest: 104 })).pullRequest).toBe(104);
    expect(parseBatch(batch()).pullRequest).toBeUndefined();
  });

  it('rejects a pull request number that is zero, negative or not a whole number', () => {
    for (const pullRequest of [0, -1, 1.5, '104']) {
      expect(() => parseBatch(batch({ pullRequest }))).toThrow();
    }
  });

  it('accepts a batch with filing one', () => {
    expect(parseBatch(batch({ filing: 'one' })).filing).toBe('one');
    expect(parseBatch(batch({ filing: 'one', marks: [marks[0]] })).filing).toBe('one');
  });

  it('rejects a batch whose filing is not one', () => {
    for (const filing of ['many', 'ONE', '', 1, true, null]) {
      expect(() => parseBatch(batch({ filing }))).toThrow();
    }
  });

  it('leaves filing out of a batch that has none', () => {
    expect('filing' in parseBatch(batch())).toBe(false);
  });

  it('preserves an optional review id on a batch', () => {
    expect(parseBatch(batch({ review: REVIEW })).review).toBe(REVIEW);
    expect('review' in parseBatch(batch())).toBe(false);
  });

  it('rejects malformed review ids on a batch', () => {
    const wrong = [REVIEW.slice(1), `${REVIEW}a`, REVIEW.toUpperCase(), `0${REVIEW.slice(1)}`];
    for (const review of ['', ...wrong, `${REVIEW.slice(1)}\n`, 26, null]) {
      expect(() => parseBatch(batch({ review }))).toThrow();
    }
  });

  it('preserves review with pullRequest for ingest refusal', () => {
    const parsed = parseBatch(batch({ review: REVIEW, pullRequest: 104 }));
    expect(parsed.review).toBe(REVIEW);
    expect(parsed.pullRequest).toBe(104);
  });

  it('round trips generated review ids without changing ordinary batches', () => {
    const reviewId = fc
      .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz234567'), {
        minLength: 26,
        maxLength: 26,
      })
      .map((chars) => chars.join(''));
    fc.assert(
      fc.property(fc.option(reviewId, { nil: undefined }), (review) => {
        const ordinary = parseBatch(batch());
        const sent = review === undefined ? batch() : batch({ review });
        const parsed = parseBatch(JSON.parse(JSON.stringify(sent)));
        expect(parsed).toEqual(review === undefined ? ordinary : { ...ordinary, review });
      }),
      { seed: 3920 },
    );
  });

  it('rejects schemaVersion 2', () => {
    expect(() => parseBatch(batch({ schemaVersion: 2 }))).toThrow();
  });
});
