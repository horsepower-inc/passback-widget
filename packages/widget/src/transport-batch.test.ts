// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelAck, ChannelMark, Payload } from '@passback/schema';
import { createTransport } from './transport';
import { NO_ANSWER, REFUSED } from './send';
import type { Hot } from './channel';

function fakeHot() {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const sent: Array<{ event: string; data: unknown }> = [];
  const hot: Hot = {
    send(event, data) {
      sent.push({ event, data });
    },
    on(event, cb) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)?.add(cb);
    },
    off(event, cb) {
      handlers.get(event)?.delete(cb);
    },
  };
  const trigger = (event: string, data: unknown) => {
    for (const cb of handlers.get(event) ?? []) cb(data);
  };
  return { hot, sent, trigger };
}

function payload(comment: string): Payload {
  return {
    schemaVersion: 1,
    code: { framework: 'react', chain: [{ name: 'Root' }], buildId: 'abc123' },
    element: {
      selectors: [{ kind: 'css', value: 'button' }],
      tag: 'button',
      attrs: {},
      text: 'Click',
      outerHTML: '<button>Click</button>',
    },
    visual: {
      rects: {
        self: { x: 0, y: 0, width: 10, height: 10 },
        parent: { x: 0, y: 0, width: 20, height: 20 },
      },
      styles: {},
      flags: { clipped: false, covered: false, offViewport: false },
    },
    runtime: { url: 'http://localhost/', route: '/' },
    timeline: [],
    environment: {
      ua: 'test-agent',
      viewport: [1024, 768],
      dpr: 1,
      locale: 'en-US',
      tz: 'UTC',
      colorScheme: 'light',
      reducedMotion: false,
    },
    intent: { comment, category: 'functional', annotations: [] },
  };
}

const BATCH_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ack = (over: Partial<ChannelAck>): ChannelAck => ({
  v: 1,
  batchId: BATCH_ID,
  accepted: [],
  trimmed: [],
  ...over,
});

function make() {
  const h = fakeHot();
  const transport = createTransport({
    hot: h.hot,
    endpoint: 'http://localhost/mark',
    onStatus: () => {},
    newId: () => BATCH_ID,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  return { ...h, transport };
}

describe('Transport.sendBatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the POST transport sends N payloads as one batch flagged filing one', async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(ack({ batchId: 'B', accepted: ['r', 'r'] })), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const transport = createTransport({
      endpoint: 'http://localhost/mark',
      onStatus: () => {},
      fetchFn,
    });
    const result = await transport.sendBatch([payload('1'), payload('2')]);
    expect(result).toEqual({ ok: true, ids: ['r', 'r'], trimmed: [false, false] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const mark = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body)) as ChannelMark;
    expect(mark.batch.filing).toBe('one');
    expect(mark.batch.marks).toHaveLength(2);
  });

  it('the HMR transport sends N payloads as one batch without filing and returns the ids in order', async () => {
    const { transport, sent, trigger } = make();
    const promise = transport.sendBatch([payload('1'), payload('2'), payload('3')]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.event).toBe('passback:mark');
    const mark = sent[0]?.data as ChannelMark;
    expect(mark.batch.marks).toHaveLength(3);
    expect('filing' in mark.batch).toBe(false);
    trigger('passback:ack', ack({ accepted: ['a', 'b', 'c'], trimmed: ['b'] }));
    await expect(promise).resolves.toEqual({
      ok: true,
      ids: ['a', 'b', 'c'],
      trimmed: [false, true, false],
    });
  });

  it('the HMR transport fails the batch when the ack carries fewer ids than marks', async () => {
    const { transport, trigger } = make();
    const promise = transport.sendBatch([payload('1'), payload('2')]);
    trigger('passback:ack', ack({ accepted: ['a'] }));
    await expect(promise).resolves.toEqual({ ok: false, reason: 'rejected', message: REFUSED });
  });

  it('the HMR transport fails the batch when the ack carries an error', async () => {
    const { transport, trigger } = make();
    const promise = transport.sendBatch([payload('1'), payload('2')]);
    trigger('passback:ack', ack({ accepted: ['a', 'b'], error: { code: 'x', message: 'bad' } }));
    await expect(promise).resolves.toEqual({ ok: false, reason: 'rejected', message: REFUSED });
  });

  it('the HMR transport fails the batch when no ack arrives in time', async () => {
    const { transport } = make();
    const promise = transport.sendBatch([payload('1'), payload('2')]);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).resolves.toEqual({ ok: false, reason: 'network', message: NO_ANSWER });
  });

  it('dispose settles a pending batch as a network failure', async () => {
    const { transport, trigger } = make();
    const promise = transport.sendBatch([payload('1'), payload('2')]);
    transport.dispose();
    await expect(promise).resolves.toEqual({
      ok: false,
      reason: 'network',
      message: 'transport disposed',
    });
    trigger('passback:ack', ack({ accepted: ['a', 'b'] }));
    expect(vi.getTimerCount()).toBe(0);
  });
});
