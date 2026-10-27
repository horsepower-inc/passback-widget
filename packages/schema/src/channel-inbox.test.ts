import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ChannelItems, ChannelList, ChannelVerdict, InboxItem } from './index';

const A = '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8';
const B = '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9';
const AT = '2026-10-24T10:00:00Z';
const STATUSES = ['new', 'ack', 'proposed', 'accepted', 'verified', 'declined', 'withdrawn'];

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: A,
    batchId: B,
    status: 'new',
    iteration: 1,
    route: '/pricing',
    selector: '[data-testid="price"]',
    comment: 'too tight',
    createdAt: AT,
    iterations: [],
    ...overrides,
  };
}

function ulidAt(n: number): string {
  return `01J8ZKZ8J8ZKZ8J8ZKZ8J8${String(n).padStart(4, '0')}`.slice(0, 26);
}

describe('channel inbox messages', () => {
  it('parses a version one inbox list request', () => {
    expect(ChannelList.parse({ v: 1 })).toEqual({ v: 1 });
  });

  it('parses empty and complete replacement inbox snapshots', () => {
    expect(ChannelItems.parse({ v: 1, items: [] })).toEqual({ v: 1, items: [] });
    const full = item({
      file: 'src/Price.tsx:4:2',
      orphaned: true,
      parked: false,
      status: 'proposed',
      iteration: 2,
      iterations: [
        {
          n: 1,
          agent: { at: AT, text: 'fixed' },
          human: { at: AT, verdict: { kind: 'decline', reason: 'no' } },
        },
        { n: 2, agent: { at: AT, text: 'again' } },
      ],
    });
    expect(ChannelItems.parse({ v: 1, items: [full, item({ id: B })] }).items).toEqual([
      full,
      item({ id: B }),
    ]);
  });

  it('preserves inbox statuses metadata and iteration history', () => {
    for (const status of STATUSES) expect(InboxItem.parse(item({ status })).status).toBe(status);
    const verdicts = [
      { kind: 'accept' },
      { kind: 'decline', reason: 'r' },
      { kind: 'comment', text: 't' },
    ];
    const iterations = verdicts.map((verdict, i) => ({ n: i + 1, human: { at: AT, verdict } }));
    const long = 'x'.repeat(10000);
    const parsed = InboxItem.parse(item({ comment: long, parked: true, iterations }));
    expect(parsed.iterations).toEqual(iterations);
    expect(parsed.comment).toBe(long);
    expect(parsed.parked).toBe(true);
    expect(InboxItem.parse(item()).parked).toBeUndefined();
  });

  it('accepts all four local verdict actions', () => {
    for (const verdict of ['accept', 'withdraw', 'park', 'unpark']) {
      expect(ChannelVerdict.parse({ v: 1, markId: A, verdict })).toEqual({
        v: 1,
        markId: A,
        verdict,
      });
    }
  });

  it('rejects invalid inbox message versions and fields', () => {
    expect(() => ChannelList.parse({ v: 2 })).toThrow();
    expect(() => ChannelList.parse({})).toThrow();
    expect(() => ChannelItems.parse({ v: 2, items: [] })).toThrow();
    expect(() => ChannelItems.parse({ v: 1 })).toThrow();
    expect(() => ChannelVerdict.parse({ v: 2, markId: A, verdict: 'accept' })).toThrow();
    expect(() => ChannelVerdict.parse({ v: 1, markId: 'nope', verdict: 'accept' })).toThrow();
    expect(() => ChannelVerdict.parse({ v: 1, markId: A, verdict: 'decline' })).toThrow();
    expect(() => ChannelVerdict.parse({ v: 1, verdict: 'accept' })).toThrow();
    for (const key of [
      'id',
      'batchId',
      'status',
      'iteration',
      'route',
      'selector',
      'comment',
      'createdAt',
      'iterations',
    ]) {
      const partial: Record<string, unknown> = item();
      delete partial[key];
      expect(() => InboxItem.parse(partial), key).toThrow();
    }
    const bad: Record<string, unknown>[] = [
      { id: 'x' },
      { batchId: 'x' },
      { status: 'done' },
      { iteration: 0 },
      { iteration: 1.5 },
      { createdAt: 'yesterday' },
      { orphaned: 'yes' },
      { parked: 1 },
      { file: 3 },
      { iterations: [{ n: 0 }] },
      { iterations: [{ n: 1.5 }] },
      { iterations: [{ n: 1, agent: { at: 'x', text: 't' } }] },
      { iterations: [{ n: 1, agent: { at: AT } }] },
      { iterations: [{ n: 1, human: { at: AT } }] },
      { iterations: [{ n: 1, human: { at: AT, verdict: { kind: 'decline' } } }] },
      { iterations: [{ n: 1, human: { at: AT, verdict: { kind: 'comment', reason: 'r' } } }] },
      { iterations: [{ n: 1, human: { at: AT, verdict: { kind: 'maybe' } } }] },
      { iterations: [{ n: 1, human: { at: 'x', verdict: { kind: 'accept' } } }] },
    ];
    for (const o of bad)
      expect(() => ChannelItems.parse({ v: 1, items: [item(o)] }), JSON.stringify(o)).toThrow();
  });

  it('rejects duplicate snapshot item ids', () => {
    expect(() => ChannelItems.parse({ v: 1, items: [item(), item()] })).toThrow();
  });

  it('round trips generated inbox snapshots without the batch size limit', () => {
    const twentyOne = Array.from({ length: 21 }, (_, i) => item({ id: ulidAt(i) }));
    const fixed = ChannelItems.parse({ v: 1, items: twentyOne });
    expect(fixed.items).toHaveLength(21);

    const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.split('');
    const idArb = fc
      .array(fc.constantFrom(...crockford), { minLength: 25, maxLength: 25 })
      .map((c) => `0${c.join('')}`);
    const dateArb = fc
      .date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true })
      .map((d) => d.toISOString());
    const iterArb = fc.record(
      {
        n: fc.integer({ min: 1, max: 1000 }),
        agent: fc.record({ at: dateArb, text: fc.string() }),
        human: fc.record({
          at: dateArb,
          verdict: fc.oneof(
            fc.constant({ kind: 'accept' as const }),
            fc.record({ kind: fc.constant('decline' as const), reason: fc.string() }),
            fc.record({ kind: fc.constant('comment' as const), text: fc.string() }),
          ),
        }),
      },
      { requiredKeys: ['n'] },
    );
    const itemArb = fc.record(
      {
        id: idArb,
        batchId: idArb,
        status: fc.constantFrom(...STATUSES),
        iteration: fc.integer({ min: 1, max: 1000 }),
        route: fc.string(),
        selector: fc.string(),
        comment: fc.string(),
        createdAt: dateArb,
        iterations: fc.array(iterArb, { maxLength: 4 }),
        file: fc.string(),
        orphaned: fc.boolean(),
        parked: fc.boolean(),
      },
      {
        requiredKeys: [
          'id',
          'batchId',
          'status',
          'iteration',
          'route',
          'selector',
          'comment',
          'createdAt',
          'iterations',
        ],
      },
    );
    fc.assert(
      fc.property(
        fc.uniqueArray(itemArb, { minLength: 21, maxLength: 30, selector: (i) => i.id }),
        (items) => {
          const parsed = ChannelItems.parse({ v: 1, items });
          expect(parsed.items).toHaveLength(items.length);
          expect(ChannelItems.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
        },
      ),
      { numRuns: 25 },
    );
  });
});
