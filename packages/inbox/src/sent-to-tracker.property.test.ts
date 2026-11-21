import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parsePayload } from '@passback/schema';
import { fromPayload, markSentToTracker, parse, render } from './index';
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

const text = fc.oneof(
  fc.string({ unit: 'binary', minLength: 1, maxLength: 60 }),
  fc.constantFrom('"', '\\', '\\"', 'é漢字😀', '{"a":1}', '"\\u0000"'),
);

describe('sent to tracker properties', () => {
  it('parse inverts render for generated tracker names, references and links', () => {
    fc.assert(
      fc.property(
        text,
        text,
        fc.option(fc.string({ unit: 'binary', maxLength: 80 }), { nil: undefined }),
        fc.constantFrom(...MARK_STATUSES),
        fc.boolean(),
        (tracker, ref, url, status, parked) => {
          const sent = { tracker, ref, ...(url !== undefined ? { url } : {}) };
          const file = {
            ...markSentToTracker(fromPayload(payloads[0]!, meta), sent),
            status,
            ...(parked ? { parked: true } : {}),
          };
          const out = render(file);
          expect(out.split('\n').filter((l) => l.startsWith('sentToTracker: '))).toHaveLength(1);
          expect(parse(out)).toEqual(file);
          expect(render(parse(out))).toBe(out);
        },
      ),
      { numRuns: 200 },
    );
  });
});
