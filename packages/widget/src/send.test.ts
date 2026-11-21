// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { ChannelMark, Payload } from '@passback/schema';
import { sendMark } from './send';

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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const FIXED_NOW = () => new Date('2026-01-01T00:00:00.000Z');
const FIXED_ID = () => '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function sendWith(fetchFn: typeof fetch) {
  return sendMark({
    payload: basePayload(),
    endpoint: 'http://localhost/mark',
    fetchFn,
    now: FIXED_NOW,
    newId: FIXED_ID,
  });
}

describe('sendMark', () => {
  it('posts one ChannelMark batch of one as JSON', async () => {
    const payload = basePayload();
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { v: 1, batchId: FIXED_ID(), accepted: [FIXED_ID()], trimmed: [] }),
      );

    await sendMark({
      payload,
      endpoint: 'http://localhost/mark',
      fetchFn,
      now: FIXED_NOW,
      newId: FIXED_ID,
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://localhost/mark');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });

    const sent: ChannelMark = JSON.parse(init.body);
    expect(sent).toEqual({
      v: 1,
      batch: {
        schemaVersion: 1,
        id: FIXED_ID(),
        createdAt: FIXED_NOW().toISOString(),
        marks: [payload],
      },
    });
  });

  it('writes the pull request number on the batch when one is given', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { v: 1, batchId: FIXED_ID(), accepted: [FIXED_ID()], trimmed: [] }),
      );

    await sendMark({
      payload: basePayload(),
      endpoint: 'http://localhost/mark',
      fetchFn,
      now: FIXED_NOW,
      newId: FIXED_ID,
      pullRequest: 104,
    });

    const sent: ChannelMark = JSON.parse(fetchFn.mock.calls[0]![1].body);
    expect(sent.batch.pullRequest).toBe(104);
  });

  it('leaves pullRequest out of the batch when none is given', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { v: 1, batchId: FIXED_ID(), accepted: [FIXED_ID()], trimmed: [] }),
      );

    await sendMark({
      payload: basePayload(),
      endpoint: 'http://localhost/mark',
      fetchFn,
      now: FIXED_NOW,
      newId: FIXED_ID,
      pullRequest: undefined,
    });

    const sent: ChannelMark = JSON.parse(fetchFn.mock.calls[0]![1].body);
    expect(Object.hasOwn(sent.batch, 'pullRequest')).toBe(false);
  });

  it('trims a payload over 50 KB before sending and reports trimmed', async () => {
    const payload = basePayload({
      element: {
        selectors: [{ kind: 'css', value: 'button' }],
        tag: 'button',
        attrs: {},
        text: 'Click',
        outerHTML: `<button>${'x'.repeat(100_000)}</button>`,
      },
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { v: 1, batchId: FIXED_ID(), accepted: [FIXED_ID()], trimmed: [] }),
      );

    const result = await sendMark({
      payload,
      endpoint: 'http://localhost/mark',
      fetchFn,
      now: FIXED_NOW,
      newId: FIXED_ID,
    });

    expect(result).toEqual({ ok: true, id: FIXED_ID(), trimmed: true });
    const [, init] = fetchFn.mock.calls[0]!;
    const sent: ChannelMark = JSON.parse(init.body);
    expect(sent.batch.marks[0]!.element.outerHTML.length).toBeLessThan(
      payload.element.outerHTML.length,
    );
  });

  it('rejects without a request when trimming cannot fit', async () => {
    const payload = basePayload({
      intent: { comment: 'c'.repeat(60_000), category: 'functional', annotations: [] },
    });
    const fetchFn = vi.fn();

    const result = await sendMark({
      payload,
      endpoint: 'http://localhost/mark',
      fetchFn,
      now: FIXED_NOW,
      newId: FIXED_ID,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'rejected',
      message: 'the comment is too large.',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns the accepted id from the ack', async () => {
    const payload = basePayload();
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        v: 1,
        batchId: FIXED_ID(),
        accepted: ['01ARZ3NDEKTSV4RRFFQ69G5FAW'],
        trimmed: [],
      }),
    );

    const result = await sendMark({
      payload,
      endpoint: 'http://localhost/mark',
      fetchFn,
      now: FIXED_NOW,
      newId: FIXED_ID,
    });

    expect(result).toEqual({ ok: true, id: '01ARZ3NDEKTSV4RRFFQ69G5FAW', trimmed: false });
  });

  it('reports a network failure without throwing', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    expect(await sendWith(fetchFn)).toEqual({
      ok: false,
      reason: 'network',
      message: 'the server did not answer.',
    });
  });

  it('says the server refused it for a 400 error ack', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        v: 1,
        batchId: FIXED_ID(),
        accepted: [],
        trimmed: [],
        error: { code: 'invalid', message: 'batch id is not a ulid' },
      }),
    );

    expect(await sendWith(fetchFn)).toEqual({
      ok: false,
      reason: 'rejected',
      message: 'the server refused it.',
    });
  });

  it('says the server did not answer for a 502 without an ack', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('not json', { status: 502 }));

    expect(await sendWith(fetchFn)).toEqual({
      ok: false,
      reason: 'rejected',
      message: 'the server did not answer.',
    });
  });

  it('says the server refused it when a 200 body is not a valid ack', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { v: 1, batchId: FIXED_ID(), accepted: FIXED_ID(), trimmed: [] }),
      );

    expect(await sendWith(fetchFn)).toEqual({
      ok: false,
      reason: 'rejected',
      message: 'the server refused it.',
    });
  });

  it('says the comment is too large for a 413', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('too big', { status: 413 }));

    expect(await sendWith(fetchFn)).toEqual({
      ok: false,
      reason: 'rejected',
      message: 'the comment is too large.',
    });
  });

  it('says the server refused it for a 404 without an ack', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));

    expect(await sendWith(fetchFn)).toEqual({
      ok: false,
      reason: 'rejected',
      message: 'the server refused it.',
    });
  });

  it('says the site has no destination yet for a 409', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'no_destination' }), { status: 409 }));

    expect(await sendWith(fetchFn)).toEqual({
      ok: false,
      reason: 'rejected',
      message: 'this site has no destination yet.',
    });
  });
});
