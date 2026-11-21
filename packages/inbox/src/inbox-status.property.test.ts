import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse, render } from './index';
import type { InboxFile, Iteration, IterationStatus } from './inbox-file';

const isoAt = fc
  .date({
    min: new Date('2000-01-01T00:00:00Z'),
    max: new Date('2099-12-31T23:59:59Z'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString());

const messageText = fc.oneof(
  fc.string({ unit: 'binary' }),
  fc.constantFrom(
    'a\nb',
    '"q"',
    '\\',
    '**agent** x',
    '**human** y',
    '**statuses** []',
    '## Iteration 2',
    '```',
  ),
);

const entry: fc.Arbitrary<IterationStatus> = fc
  .record(
    {
      state: fc.constantFrom('queued', 'running', 'done', 'failed' as const),
      at: isoAt,
      message: messageText,
      prUrl: fc.webUrl(),
    },
    { requiredKeys: ['state', 'at'] },
  )
  .map((e) => e as IterationStatus);

const history = fc.option(fc.array(entry, { maxLength: 5 }), { nil: undefined });

const iteration = (n: number): fc.Arbitrary<Iteration> =>
  fc
    .record({ statuses: history, agent: fc.option(messageText, { nil: undefined }) })
    .map(({ statuses, agent }) => ({
      n,
      ...(statuses !== undefined ? { statuses } : {}),
      ...(agent !== undefined ? { agent: { at: '2026-09-19T14:05:00Z', text: agent } } : {}),
    }));

const iterations = fc
  .integer({ min: 0, max: 4 })
  .chain((count) => fc.tuple(...Array.from({ length: count }, (_, i) => iteration(i + 1))));

describe('inbox status history (property)', () => {
  it('parse inverts render for arbitrary per-iteration status histories', () => {
    fc.assert(
      fc.property(iterations, (its) => {
        const file: InboxFile = {
          id: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8',
          schemaVersion: 1,
          batchId: '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9',
          status: 'proposed',
          iteration: Math.max(its.length, 1),
          route: '/p',
          selector: '#a',
          createdAt: '2026-09-19T14:00:00Z',
          comment: 'c',
          annotations: [],
          iterations: its,
        };
        expect(parse(render(file))).toEqual(file);
      }),
      { numRuns: 300 },
    );
  });
});
