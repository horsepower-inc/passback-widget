import { describe, expect, it } from 'vitest';
import { ChannelItems, ChannelVerified } from './index';

const ulid = '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ8';
const ulid2 = '01J8ZKZ8J8ZKZ8J8ZKZ8J8ZKZ9';

const item = {
  id: ulid,
  batchId: ulid2,
  status: 'proposed',
  iteration: 1,
  route: '/',
  selector: '#a',
  comment: 'x',
  createdAt: '2026-09-19T14:00:00Z',
  iterations: [],
};

describe('channel verified', () => {
  it('parses a passback:verified message with one to twenty mark ids', () => {
    expect(() => ChannelVerified.parse({ v: 1, markIds: [ulid] })).not.toThrow();
    expect(() => ChannelVerified.parse({ v: 1, markIds: [ulid, ulid2] })).not.toThrow();
    expect(() =>
      ChannelVerified.parse({ v: 1, markIds: Array.from({ length: 20 }, () => ulid) }),
    ).not.toThrow();
  });

  it('rejects a verified message with no ids, twenty-one ids, a bad id or v 2', () => {
    expect(() => ChannelVerified.parse({ v: 1, markIds: [] })).toThrow();
    expect(() =>
      ChannelVerified.parse({ v: 1, markIds: Array.from({ length: 21 }, () => ulid) }),
    ).toThrow();
    expect(() => ChannelVerified.parse({ v: 1, markIds: ['not-a-ulid'] })).toThrow();
    expect(() => ChannelVerified.parse({ v: 2, markIds: [ulid] })).toThrow();
  });

  it('keeps the annotations of an inbox item and rejects an unknown annotation type', () => {
    const annotations = [
      { type: 'gap', a: 'self', b: 'prev', expected: 8, actual: 12 },
      { type: 'no-overlap', elements: ['self', 'next'] },
    ];
    const ok = ChannelItems.parse({ v: 1, items: [{ ...item, annotations }] });
    expect(ok.items[0]?.annotations).toEqual(annotations);
    expect(ChannelItems.parse({ v: 1, items: [item] }).items[0]).not.toHaveProperty('annotations');
    expect(
      ChannelItems.safeParse({ v: 1, items: [{ ...item, annotations: [{ type: 'sparkle' }] }] })
        .success,
    ).toBe(false);
  });
});
