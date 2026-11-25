// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import type { ChannelAck, ChannelMark, ChannelStatus, Payload } from '@passback/schema';
import { createTransport } from './transport';
import type { Hot } from './channel';

type FakeHot = Hot & {
  sent: Array<{ event: string; data: unknown }>;
  trigger(event: string, data: unknown): void;
};

function fakeHot(): FakeHot {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const sent: Array<{ event: string; data: unknown }> = [];
  return {
    sent,
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
    trigger(event, data) {
      for (const cb of handlers.get(event) ?? []) cb(data);
    },
  };
}

function basePayload(overrides: Partial<Payload> = {}): Payload {
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
    intent: { comment: 'Broken', category: 'functional', annotations: [] },
    ...overrides,
  };
}

function circularRuntimePayload(): Payload {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  return basePayload({ runtime: { url: 'http://localhost/', route: '/', props: circular } });
}

function oversizedPayload(): Payload {
  return basePayload({
    element: {
      selectors: [{ kind: 'css', value: 'button' }],
      tag: 'button',
      attrs: {},
      text: 'Click',
      outerHTML: `<button>${'x'.repeat(100_000)}</button>`,
    },
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const FIXED_NOW = () => new Date('2026-01-01T00:00:00.000Z');
const FIXED_ID = () => '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER_ID = () => '01ARZ3NDEKTSV4RRFFQ69G5FAW';

function fakeStatus(): ChannelStatus {
  return { v: 1, markId: FIXED_ID(), state: 'done', at: '2026-09-29T00:00:00.000Z' };
}

describe('createTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a trimmed batch over hot, resolves on its ack and never fetches', async () => {
    const hot = fakeHot();
    const fetchFn = vi.fn();
    const transport = createTransport({
      hot,
      endpoint: 'http://localhost/mark',
      onStatus: () => {},
      fetchFn,
      now: FIXED_NOW,
      newId: FIXED_ID,
    });
    const payload = oversizedPayload();

    const resultPromise = transport.send(payload);

    expect(hot.sent).toHaveLength(1);
    const sent = hot.sent[0]!;
    expect(sent.event).toBe('passback:mark');
    const mark = sent.data as ChannelMark;
    expect(mark.v).toBe(1);
    expect(mark.batch.id).toBe(FIXED_ID());
    expect(mark.batch.createdAt).toBe(FIXED_NOW().toISOString());
    expect(mark.batch.marks[0]!.element.outerHTML.length).toBeLessThan(
      payload.element.outerHTML.length,
    );

    const ack: ChannelAck = { v: 1, batchId: FIXED_ID(), accepted: [FIXED_ID()], trimmed: [] };
    hot.trigger('passback:ack', ack);

    await expect(resultPromise).resolves.toEqual({ ok: true, id: FIXED_ID(), trimmed: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('ignores an ack for another batch and rejects an error ack', async () => {
    const hot = fakeHot();
    const transport = createTransport({
      hot,
      endpoint: 'http://localhost/mark',
      onStatus: () => {},
      now: FIXED_NOW,
      newId: FIXED_ID,
    });

    const resultPromise = transport.send(basePayload());

    const foreignAck: ChannelAck = {
      v: 1,
      batchId: OTHER_ID(),
      accepted: [OTHER_ID()],
      trimmed: [],
    };
    hot.trigger('passback:ack', foreignAck);

    const errorAck: ChannelAck = {
      v: 1,
      batchId: FIXED_ID(),
      accepted: [],
      trimmed: [],
      error: { code: 'invalid', message: 'batch id is not a ulid' },
    };
    hot.trigger('passback:ack', errorAck);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      reason: 'rejected',
      message: 'the server refused it.',
    });
  });

  it('times out with a network failure when no ack arrives', async () => {
    const hot = fakeHot();
    const transport = createTransport({
      hot,
      endpoint: 'http://localhost/mark',
      onStatus: () => {},
      now: FIXED_NOW,
      newId: FIXED_ID,
    });

    const resultPromise = transport.send(basePayload());

    await vi.advanceTimersByTimeAsync(5000);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      reason: 'network',
      message: 'the server did not answer.',
    });
  });

  it('says the comment is too large when trimming cannot fit', async () => {
    const hot = fakeHot();
    const transport = createTransport({ hot, endpoint: 'http://localhost/mark', onStatus: () => {} });
    const payload = basePayload({
      intent: { comment: 'c'.repeat(60_000), category: 'functional', annotations: [] },
    });

    await expect(transport.send(payload)).resolves.toEqual({
      ok: false,
      reason: 'rejected',
      message: 'the comment is too large.',
    });
    expect(hot.sent).toHaveLength(0);
  });

  it('forwards every status to onStatus unchanged', () => {
    const hot = fakeHot();
    const onStatus = vi.fn();
    createTransport({ hot, endpoint: 'http://localhost/mark', onStatus });

    const status = fakeStatus();
    hot.trigger('passback:status', status);

    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith(status);
  });

  it('delegates to sendMark when there is no hot', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { v: 1, batchId: FIXED_ID(), accepted: [FIXED_ID()], trimmed: [] }),
      );
    const transport = createTransport({
      endpoint: 'http://localhost/mark',
      onStatus: () => {},
      fetchFn,
      now: FIXED_NOW,
      newId: FIXED_ID,
    });

    const result = await transport.send(basePayload());

    expect(result).toEqual({ ok: true, id: FIXED_ID(), trimmed: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://localhost/mark');
    expect(init.method).toBe('POST');
  });

  test('rejects instead of throwing when payload preparation throws', async () => {
    const hot = fakeHot();
    const transport = createTransport({
      hot,
      endpoint: 'http://localhost/mark',
      onStatus: () => {},
      now: FIXED_NOW,
      newId: FIXED_ID,
    });

    const result = await transport.send(circularRuntimePayload());

    expect(result).toEqual({
      ok: false,
      reason: 'rejected',
      message: expect.any(String),
    });
    expect(hot.sent).toHaveLength(0);
  });

  test('trimmed reflects ack.trimmed even when local trimming did not happen', async () => {
    const hot = fakeHot();
    const transport = createTransport({
      hot,
      endpoint: 'http://localhost/mark',
      onStatus: () => {},
      now: FIXED_NOW,
      newId: FIXED_ID,
    });

    const resultPromise = transport.send(basePayload());

    const ack: ChannelAck = {
      v: 1,
      batchId: FIXED_ID(),
      accepted: [FIXED_ID()],
      trimmed: [FIXED_ID()],
    };
    hot.trigger('passback:ack', ack);

    await expect(resultPromise).resolves.toEqual({ ok: true, id: FIXED_ID(), trimmed: true });
  });
});
