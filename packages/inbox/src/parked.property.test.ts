import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parsePayload } from '@passback/schema';
import { fromPayload, parse, render } from './index';
import { MARK_STATUSES } from './status';

const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
const payloads = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => parsePayload(JSON.parse(readFileSync(dir + f, 'utf8'))));

const meta = {
  id: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8',
  batchId: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9',
  createdAt: '2026-09-19T14:00:00Z',
};

describe('parked flag properties', () => {
  it('round-trips parked inbox files for generated comments and statuses', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: payloads.length - 1 }),
        fc.string({ unit: 'binary', maxLength: 200 }),
        fc.constantFrom(...MARK_STATUSES),
        (index, comment, status) => {
          const payload = payloads[index]!;
          const file = {
            ...fromPayload({ ...payload, intent: { ...payload.intent, comment } }, meta),
            status,
            parked: true,
          };
          const text = render(file);
          expect(text.split('\n').filter((l) => l === 'parked: true')).toHaveLength(1);
          expect(parse(text)).toEqual(file);
          const unparked = { ...file, parked: undefined };
          const plain = render(unparked);
          expect(plain.split('\n')).not.toContain('parked: true');
          expect(parse(plain).parked).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });
});
