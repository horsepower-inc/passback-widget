import { describe, expect, it, vi } from 'vitest';
import type { Payload } from '@passback/schema';
import { NO_ANSWER, REFUSED, TOO_LARGE, sendReviewMarks } from './send';

const ID = 'abcdefghijklmnopqrstuv2345';
const ENDPOINT = 'https://relay.test/v1/ingest/site-1';
const BATCH = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const mark = { intent: { comment: 'x' } } as unknown as Payload;

const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(
    async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
const ack = (...accepted: string[]) => ({ v: 1, batchId: BATCH, accepted, trimmed: [] });
const send = (fetchFn: typeof fetch, payloads = [mark, mark], extra: object = {}) =>
  sendReviewMarks({
    payloads,
    endpoint: ENDPOINT,
    review: ID,
    fetchFn,
    newId: () => BATCH,
    ...extra,
  });

describe('sendReviewMarks', () => {
  it('posts review batches without credentials or pull request routing', async () => {
    const fetchFn = answering(202, ack('c-1', 'c-2'));
    expect(await send(fetchFn, [mark, mark], { pullRequest: 104 })).toEqual({
      ok: true,
      ids: ['c-1', 'c-2'],
      trimmed: [false, false],
    });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    const { batch } = JSON.parse(init.body as string) as { batch: Record<string, unknown> };
    expect(batch).toMatchObject({ id: BATCH, review: ID, marks: [mark, mark] });
    expect(batch).not.toHaveProperty('pullRequest');
    expect(batch).not.toHaveProperty('filing');
  });

  it('validates review acknowledgements and preserves refusal details', async () => {
    for (const [status, body] of [
      [202, ack('c-1')],
      [202, ack('c-1', 'c-2', 'c-3')],
      [202, 'not json'],
      [202, { accepted: 'c-1' }],
    ] as const) {
      expect(await send(answering(status, body))).toEqual({
        ok: false,
        reason: 'rejected',
        message: REFUSED,
      });
    }
    expect(await send(answering(200, ack('c-1', 'c-2')))).toMatchObject({ ok: false, status: 200 });

    for (const [status, body] of [
      [404, { code: 'review_not_found' }],
      [409, { code: 'review_finished' }],
      [410, { code: 'review_expired' }],
      [409, { code: 'review_held', comments: ['c-1', 'c-2'] }],
      [502, { code: 'file_failed' }],
    ] as const) {
      expect(await send(answering(status, body))).toMatchObject({ ok: false, status, ...body });
    }
    expect(await send(answering(409, { code: 'review_held', comments: ['a', 7] }))).toMatchObject({
      comments: ['a'],
    });
    expect(await send(answering(500, 'down'))).toEqual({
      ok: false,
      reason: 'rejected',
      message: NO_ANSWER,
      status: 500,
    });

    const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    expect(await send(offline)).toEqual({ ok: false, reason: 'network', message: NO_ANSWER });
    expect(await send(offline, [])).toMatchObject({ message: TOO_LARGE });
    expect(offline).toHaveBeenCalledOnce();
  });
});
