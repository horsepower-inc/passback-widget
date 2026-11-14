import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ChannelItems, InboxItem } from './index';

const A = '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8';
const B = '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9';
const AT = '2026-10-24T10:00:00Z';

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

function withStatuses(statuses: unknown[]) {
  return item({ iterations: [{ n: 1, statuses }] });
}

describe('channel rows', () => {
  it('keeps the target of an item and rejects a target without a tag or text', () => {
    const target = { tag: 'button', text: 'Buy' };
    expect(InboxItem.parse(item({ target })).target).toEqual(target);
    expect(() => InboxItem.parse(item({ target: { tag: 'button' } }))).toThrow();
    expect(() => InboxItem.parse(item({ target: { text: 'Buy' } }))).toThrow();
    expect(() => InboxItem.parse(item({ target: { tag: 1, text: 'Buy' } }))).toThrow();
  });

  it('keeps the status history of an iteration and rejects an entry with another key or an unknown state', () => {
    const statuses = [
      { state: 'queued', at: AT },
      { state: 'running', message: 'working', at: AT },
      { state: 'done', prUrl: 'https://github.com/o/r/pull/1', at: AT },
    ];
    expect(InboxItem.parse(withStatuses(statuses)).iterations[0]?.statuses).toEqual(statuses);
    expect(() => InboxItem.parse(withStatuses([{ state: 'queued', at: AT, extra: 1 }]))).toThrow();
    expect(() => InboxItem.parse(withStatuses([{ state: 'v', markId: A, at: AT }]))).toThrow();
    expect(() => InboxItem.parse(withStatuses([{ state: 'paused', at: AT }]))).toThrow();
    expect(() =>
      InboxItem.parse(withStatuses([{ state: 'done', prUrl: 'nope', at: AT }])),
    ).toThrow();
    expect(() => InboxItem.parse(withStatuses([{ state: 'done', at: 'x' }]))).toThrow();
    expect(() => InboxItem.parse(withStatuses([{ at: AT }]))).toThrow();
  });

  it('keeps truncated on a snapshot and rejects a value that is not a boolean', () => {
    expect(ChannelItems.parse({ v: 1, items: [], truncated: true }).truncated).toBe(true);
    expect(ChannelItems.parse({ v: 1, items: [], truncated: false }).truncated).toBe(false);
    expect(() => ChannelItems.parse({ v: 1, items: [], truncated: 'yes' })).toThrow();
    expect(() => ChannelItems.parse({ v: 1, items: [], truncated: 1 })).toThrow();
  });

  it('parses a snapshot without target, statuses or truncated exactly as before', () => {
    const snapshot = {
      v: 1,
      items: [item({ iterations: [{ n: 1, agent: { at: AT, text: 'x' } }] })],
    };
    const parsed = ChannelItems.parse(snapshot);
    expect(parsed).toEqual(snapshot);
    expect('truncated' in parsed).toBe(false);
    expect('target' in parsed.items[0]!).toBe(false);
    expect('statuses' in parsed.items[0]!.iterations[0]!).toBe(false);
  });

  it('round trips generated rows with target, statuses and truncated', () => {
    const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.split('');
    const idArb = fc
      .array(fc.constantFrom(...crockford), { minLength: 25, maxLength: 25 })
      .map((c) => `0${c.join('')}`);
    const dateArb = fc
      .date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true })
      .map((d) => d.toISOString());
    const statusArb = fc.record(
      {
        state: fc.constantFrom('queued', 'running', 'done', 'failed'),
        message: fc.string(),
        prUrl: fc.constantFrom('https://github.com/o/r/pull/1', 'http://localhost:3000/x'),
        at: dateArb,
      },
      { requiredKeys: ['state', 'at'] },
    );
    const iterArb = fc.record(
      {
        n: fc.integer({ min: 1, max: 1000 }),
        statuses: fc.array(statusArb, { maxLength: 4 }),
      },
      { requiredKeys: ['n'] },
    );
    const itemArb = fc.record(
      {
        id: idArb,
        batchId: idArb,
        status: fc.constantFrom('new', 'ack', 'proposed', 'accepted'),
        iteration: fc.integer({ min: 1, max: 1000 }),
        route: fc.string(),
        selector: fc.string(),
        comment: fc.string(),
        createdAt: dateArb,
        iterations: fc.array(iterArb, { maxLength: 4 }),
        target: fc.record({ tag: fc.string(), text: fc.string() }),
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
        fc.uniqueArray(itemArb, { maxLength: 8, selector: (i) => i.id }),
        fc.boolean(),
        (items, truncated) => {
          const input = { v: 1, items, truncated };
          const parsed = ChannelItems.parse(input);
          expect(parsed).toEqual(input);
          expect(ChannelItems.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
        },
      ),
      { numRuns: 25 },
    );
  });
});
