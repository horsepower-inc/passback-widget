import { describe, expect, it, vi } from 'vitest';
import type { ChannelAck, ChannelMark, Payload } from '@passback/schema';
import { NO_ANSWER, REFUSED, TOO_LARGE, sendMark, sendMarks } from './send';

function basePayload(comment = 'Broken'): Payload {
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

function oversizedPayload(): Payload {
  const p = basePayload();
  p.element.outerHTML = `<button>${'x'.repeat(100_000)}</button>`;
  return p;
}

function ackResponse(accepted: string[], extra: Partial<ChannelAck> = {}, status = 200): Response {
  const ack: ChannelAck = { v: 1, batchId: 'B', accepted, trimmed: [], ...extra };
  return new Response(JSON.stringify(ack), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(response: Response) {
  const fetchFn = vi.fn<typeof fetch>(async () => response);
  const body = () => JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body)) as ChannelMark;
  return { fetchFn: fetchFn, calls: fetchFn, body };
}

const endpoint = 'http://localhost/mark';

describe('sendMarks', () => {
  it('posts one batch of N marks flagged filing one', async () => {
    const s = setup(ackResponse(['a', 'a', 'a']));
    const payloads = [basePayload('1'), basePayload('2'), basePayload('3')];
    const result = await sendMarks({ payloads, endpoint, fetchFn: s.fetchFn });
    expect(result.ok).toBe(true);
    expect(s.calls).toHaveBeenCalledTimes(1);
    const mark = s.body();
    expect(mark.v).toBe(1);
    expect(mark.batch.filing).toBe('one');
    expect(mark.batch.marks.map((m) => m.intent.comment)).toEqual(['1', '2', '3']);
  });

  it('sends a batch of one without a filing key', async () => {
    const s = setup(ackResponse(['a']));
    await sendMarks({ payloads: [basePayload()], endpoint, fetchFn: s.fetchFn });
    expect('filing' in s.body().batch).toBe(false);
  });

  it('reads one accepted id per mark in mark order', async () => {
    const s = setup(ackResponse(['x', 'y']));
    const result = await sendMarks({
      payloads: [basePayload(), basePayload()],
      endpoint,
      fetchFn: s.fetchFn,
    });
    expect(result).toEqual({ ok: true, ids: ['x', 'y'], trimmed: [false, false] });

    const same = setup(ackResponse(['r', 'r', 'r']));
    const hosted = await sendMarks({
      payloads: [basePayload(), basePayload(), basePayload()],
      endpoint,
      fetchFn: same.fetchFn,
    });
    expect(hosted).toEqual({ ok: true, ids: ['r', 'r', 'r'], trimmed: [false, false, false] });
  });

  it('marks the trimmed flag of the mark the ack names as trimmed', async () => {
    const s = setup(ackResponse(['x', 'y'], { trimmed: ['y'] }));
    const result = await sendMarks({
      payloads: [basePayload(), basePayload()],
      endpoint,
      fetchFn: s.fetchFn,
    });
    expect(result).toEqual({ ok: true, ids: ['x', 'y'], trimmed: [false, true] });

    const local = setup(ackResponse(['x', 'y']));
    const big = await sendMarks({
      payloads: [oversizedPayload(), basePayload()],
      endpoint,
      fetchFn: local.fetchFn,
    });
    expect(big).toEqual({ ok: true, ids: ['x', 'y'], trimmed: [true, false] });
  });

  it('fails the whole send when the ack carries fewer ids than marks', async () => {
    const s = setup(ackResponse(['x']));
    const result = await sendMarks({
      payloads: [basePayload(), basePayload()],
      endpoint,
      fetchFn: s.fetchFn,
    });
    expect(result).toEqual({ ok: false, reason: 'rejected', message: REFUSED });

    const err = setup(ackResponse(['x', 'y'], { error: { code: 'x', message: 'no' } }));
    expect(
      await sendMarks({ payloads: [basePayload(), basePayload()], endpoint, fetchFn: err.fetchFn }),
    ).toMatchObject({ ok: false, reason: 'rejected' });

    const down = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(
      await sendMarks({
        payloads: [basePayload()],
        endpoint,
        fetchFn: down as unknown as typeof fetch,
      }),
    ).toEqual({ ok: false, reason: 'network', message: NO_ANSWER });
  });

  it('rejects an ack without a trimmed list instead of throwing', async () => {
    const response = () => new Response(JSON.stringify({ accepted: ['a'] }), { status: 200 });
    const fetchFn = vi.fn<typeof fetch>(async () => response());
    expect(await sendMarks({ payloads: [basePayload()], endpoint, fetchFn })).toEqual({
      ok: false,
      reason: 'rejected',
      message: REFUSED,
    });
    expect(await sendMark({ payload: basePayload(), endpoint, fetchFn })).toEqual({
      ok: true,
      id: 'a',
      trimmed: false,
    });
  });

  it('leaves sendMark reading the first id and only local trimming', async () => {
    const s = setup(ackResponse(['x', 'y'], { trimmed: ['x'] }));
    expect(await sendMark({ payload: basePayload(), endpoint, fetchFn: s.fetchFn })).toEqual({
      ok: true,
      id: 'x',
      trimmed: false,
    });
    expect('filing' in s.body().batch).toBe(false);
  });

  it('refuses a batch with a mark that does not fit or with more than twenty marks before any request', async () => {
    const s = setup(ackResponse([]));
    const tooLarge = { ok: false, reason: 'rejected', message: TOO_LARGE };
    expect(
      await sendMarks({ payloads: [basePayload(), hugePayload()], endpoint, fetchFn: s.fetchFn }),
    ).toEqual(tooLarge);
    expect(
      await sendMarks({
        payloads: Array.from({ length: 21 }, () => basePayload()),
        endpoint,
        fetchFn: s.fetchFn,
      }),
    ).toEqual(tooLarge);
    expect(await sendMarks({ payloads: [], endpoint, fetchFn: s.fetchFn })).toEqual(tooLarge);
    expect(s.calls).not.toHaveBeenCalled();
  });

  it('writes the pull request number on the batch', async () => {
    const s = setup(ackResponse(['a', 'a']));
    await sendMarks({
      payloads: [basePayload(), basePayload()],
      endpoint,
      fetchFn: s.fetchFn,
      pullRequest: 42,
    });
    expect(s.body().batch.pullRequest).toBe(42);
  });
});

function hugePayload(): Payload {
  const p = basePayload();
  p.intent.comment = 'c'.repeat(2_000_000);
  return p;
}
