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

describe('channel inbox sentToTracker', () => {
  it('keeps the tracker, the issue reference and the link of an item sent to a tracker', () => {
    const sentToTracker = { tracker: 'github', ref: 'acme/web#12', url: 'https://example.test/12' };
    expect(InboxItem.parse(item({ sentToTracker })).sentToTracker).toEqual(sentToTracker);
    const snapshot = ChannelItems.parse({ v: 1, items: [item({ sentToTracker })] });
    expect(snapshot.items[0]?.sentToTracker).toEqual(sentToTracker);
    const noUrl = { tracker: 'linear', ref: 'ENG-1' };
    expect(InboxItem.parse(item({ sentToTracker: noUrl })).sentToTracker).toEqual(noUrl);
  });

  it('rejects a sent-to-tracker value with an empty tracker or reference, a numeric link or another key', () => {
    const bad: unknown[] = [
      { tracker: '', ref: 'ENG-1' },
      { tracker: 'linear', ref: '' },
      { tracker: 'linear' },
      { ref: 'ENG-1' },
      { tracker: 'linear', ref: 'ENG-1', url: 3 },
      { tracker: 'linear', ref: 'ENG-1', extra: true },
      'linear',
      null,
    ];
    for (const sentToTracker of bad)
      expect(
        () => InboxItem.parse(item({ sentToTracker })),
        JSON.stringify(sentToTracker),
      ).toThrow();
  });

  it('parses an item without the field exactly as before and keeps it independent of parked', () => {
    expect(InboxItem.parse(item())).toEqual(item());
    expect('sentToTracker' in InboxItem.parse(item())).toBe(false);
    const sent = { tracker: 'linear', ref: 'ENG-1' };
    const parked = InboxItem.parse(item({ sentToTracker: sent }));
    expect(parked.parked).toBeUndefined();
    const both = InboxItem.parse(item({ sentToTracker: sent, parked: true }));
    expect(both.parked).toBe(true);
    expect(InboxItem.parse(item({ parked: true })).sentToTracker).toBeUndefined();
  });

  it('round trips generated sent-to-tracker values through a snapshot', () => {
    const sentArb = fc.record(
      { tracker: fc.string({ minLength: 1 }), ref: fc.string({ minLength: 1 }), url: fc.string() },
      { requiredKeys: ['tracker', 'ref'] },
    );
    fc.assert(
      fc.property(sentArb, (sentToTracker) => {
        const parsed = ChannelItems.parse({ v: 1, items: [item({ sentToTracker })] });
        expect(parsed.items[0]?.sentToTracker).toEqual(sentToTracker);
        expect(ChannelItems.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
      }),
      { numRuns: 100 },
    );
  });
});
