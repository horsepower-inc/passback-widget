// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Payload } from '@passback/schema';
import { NO_ANSWER, SEND_TIMEOUT_MS, TOO_LARGE, sendMark, sendMarks } from './send';

function payload(comment = 'Broken'): Payload {
  return {
    schemaVersion: 1,
    code: { framework: 'react', chain: [], buildId: 'abc123' },
    element: { selectors: [], tag: 'button', attrs: {}, text: '', outerHTML: '<button/>' },
    visual: { rects: {}, styles: {}, flags: {} },
    runtime: { url: 'http://localhost/', route: '/' },
    timeline: [],
    environment: {},
    intent: { comment, category: 'functional', annotations: [] },
  } as unknown as Payload;
}

const endpoint = 'https://relay.example.test/v1/ingest/demo';
const failure = { ok: false, reason: 'network', message: NO_ANSWER };
const ack = (ids: string[]) => ({
  ok: true,
  json: async () => ({ v: 1, batchId: 'B', accepted: ids, trimmed: [] }),
});

describe('relay send timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('answers that the server did not answer when the relay stalls past the limit, and aborts the request', async () => {
    let signal: AbortSignal | null | undefined;
    const fetchFn = vi.fn((_u: unknown, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    });
    const result = sendMark({ payload: payload(), endpoint, fetchFn: fetchFn as never });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect(await result).toEqual(failure);
    expect(signal?.aborted).toBe(true);
  });

  it('answers the same when the answer body never arrives', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: () => new Promise(() => {}),
    }));
    const result = sendMark({ payload: payload(), endpoint, fetchFn: fetchFn as never });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect(await result).toEqual(failure);
  });

  it('leaves no timer behind after an answer in time, a rejected request or a comment that is too large', async () => {
    const late = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve(ack(['m1'])), SEND_TIMEOUT_MS - 1)),
    );
    const pending = sendMark({ payload: payload(), endpoint, fetchFn: late as never });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1);
    expect((await pending).ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    const rejecting = vi.fn(() => Promise.reject(new Error('offline')));
    expect(await sendMark({ payload: payload(), endpoint, fetchFn: rejecting as never })).toEqual(
      failure,
    );
    expect(vi.getTimerCount()).toBe(0);

    const result = await sendMarks({ payloads: [], endpoint, fetchFn: rejecting as never });
    expect(result).toMatchObject({ ok: false, message: TOO_LARGE });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores an answer that arrives after the limit and gives a retry its own signal', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    let resolveFirst: (r: unknown) => void = () => {};
    const fetchFn = vi.fn((_u: unknown, init?: RequestInit) => {
      signals.push(init?.signal);
      return signals.length === 1
        ? new Promise((r) => (resolveFirst = r))
        : Promise.resolve(ack(['m2']));
    });
    const first = sendMark({ payload: payload(), endpoint, fetchFn: fetchFn as never });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    resolveFirst(ack(['m1']));
    expect(await first).toEqual(failure);
    expect((await sendMark({ payload: payload(), endpoint, fetchFn: fetchFn as never })).ok).toBe(
      true,
    );
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('applies the same limit to a batch', async () => {
    const fetchFn = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_r, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const result = sendMarks({
      payloads: [payload('A'), payload('B')],
      endpoint,
      fetchFn: fetchFn as never,
    });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect(await result).toEqual(failure);
    expect(vi.getTimerCount()).toBe(0);
  });
});
