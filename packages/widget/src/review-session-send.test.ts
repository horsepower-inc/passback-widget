import { describe, expect, it, vi } from 'vitest';
import type { Payload } from '@passback/schema';
import { REVIEW_STORAGE_KEY } from './review-link';
import { createReviewSession, type ReviewClient, type ReviewSession } from './review-session';

const ID = 'abcdefghijklmnopqrstuv2345';
const ENDPOINT = 'https://relay.test/v1/ingest/site-1';
const BATCH = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const mark = { intent: { comment: 'x' } } as unknown as Payload;

const comment = (id: string) => ({
  id,
  mark: `m-${id}`,
  text: id,
  label: null,
  status: 'open',
  tone: 'plain' as const,
  overruled: false,
});
const open: ReviewSession = {
  v: 1,
  state: 'open',
  title: 'Revue',
  version: 'rc1',
  round: 1,
  check: 'Ça marche ?',
  labels: [],
  finish: [{ key: 'send_back', label: 'Renvoyer', enabled: true }],
  featureUrl: 'https://track.test/feature',
  expiresAt: '2026-11-03T00:00:00Z',
  cursor: 'c1',
  comments: [comment('a'), comment('b')],
};
const reply = (status: number, body: unknown) =>
  ({ ok: status < 300, status, json: async () => body }) as Response;
const unreadable = {
  ok: true,
  status: 200,
  json: () => Promise.reject(new SyntaxError('not json')),
} as Response;
const offline = new TypeError('offline');

async function opened(first: unknown = reply(200, open), flush = async () => true) {
  const data = new Map<string, string>();
  const sessionStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  const queue: unknown[] = [first];
  const fetchFn = vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next as Response;
  });
  const timers = new Set<number>();
  let polled = () => {};
  const updates: unknown[] = [];
  const flushFn = vi.fn(flush);
  const c = createReviewSession({
    win: { location: { hash: `#pb-review${ID}` }, sessionStorage } as never,
    endpoint: ENDPOINT,
    fetchFn,
    flush: flushFn,
    state: () => ({ visible: true, open: true }),
    newId: () => `id-${fetchFn.mock.calls.length}`,
    setTimer: (run) => {
      polled = run;
      timers.add(1);
      return 1;
    },
    clearTimer: () => timers.clear(),
    onUpdate: (update) => updates.push(update),
  });
  const settled = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  await settled();
  const poll = () => {
    timers.clear();
    polled();
  };
  const call = (i: number) => {
    const [url, init] = fetchFn.mock.calls[i] as [string, RequestInit];
    return { url, init, body: JSON.parse(init.body as string) as Record<string, unknown> };
  };
  return { c, data, queue, fetchFn, timers, updates, flushFn, call, poll, settled };
}

describe('review session sending', () => {
  it('enables review batches only after a successful read', async () => {
    const failed = await opened(offline);
    expect(await failed.c.send([mark])).toMatchObject({ ok: false, code: 'review_inactive' });
    expect(failed.fetchFn).toHaveBeenCalledOnce();

    const h = await opened();
    h.queue.push(reply(202, { v: 1, batchId: BATCH, accepted: ['c-1'], trimmed: [] }));
    expect(await h.c.send([mark])).toMatchObject({ ok: true, ids: ['c-1'], trimmed: [false] });
    const { url, init, body } = h.call(1);
    expect(url).toBe(ENDPOINT);
    expect(init.credentials).toBe('omit');
    expect(body.batch).toMatchObject({ review: ID });
    expect(body.batch).not.toHaveProperty('pullRequest');
  });

  it('merges overrules and reports held comment ids', async () => {
    const h = await opened();
    const before = h.c.session();
    h.queue.push(reply(200, { v: 1, comment: 'a', status: 'kept' }));
    expect(await h.c.overrule('a', 'k')).toEqual({ ok: true, comment: 'a', status: 'kept' });
    const { url, init, body } = h.call(1);
    expect(url).toBe(`${ENDPOINT}/review/overrule`);
    expect(init.credentials).toBe('omit');
    expect(body).toEqual({ v: 1, review: ID, comment: 'a', label: 'k' });
    const after = h.c.session();
    expect(after?.comments.map((x) => [x.id, x.status, x.overruled])).toEqual([
      ['a', 'kept', true],
      ['b', 'open', false],
    ]);
    expect(before).toEqual(open);
    expect(h.updates.at(-1)).toEqual({ kind: 'session', session: after });

    for (const bad of [
      reply(200, open),
      reply(200, { v: 1, comment: 'b', status: 'kept' }),
      unreadable,
    ]) {
      h.queue.push(bad);
      expect(await h.c.overrule('a', 'k')).toMatchObject({ ok: false, reason: 'rejected' });
      expect(h.c.session()).toBe(after);
    }

    h.queue.push(reply(409, { code: 'review_held', comments: ['a', 'b'] }));
    expect(await h.c.overrule('b', 'k')).toMatchObject({
      code: 'review_held',
      comments: ['a', 'b'],
    });
    expect(h.c.session()).toBe(after);
    expect(h.data.get(REVIEW_STORAGE_KEY)).toBe(ID);
  });

  it('a read that started before an overrule does not undo it', async () => {
    const h = await opened();
    let answer: (value: unknown) => void = () => undefined;
    h.queue.push(new Promise((resolve) => (answer = resolve)));
    h.poll();
    h.queue.push(reply(200, { v: 1, comment: 'a', status: 'kept' }));
    await h.c.overrule('a', 'k');
    const after = h.c.session();
    const seen = h.updates.length;

    answer(reply(200, { ...open, cursor: 'c2', comments: [comment('a')] }));
    await h.settled();
    expect(h.c.session()).toBe(after);
    expect(h.updates).toHaveLength(seen);
    expect(h.timers.size).toBe(1);

    h.queue.push(reply(200, { ...open, cursor: 'c3', comments: [comment('b')] }));
    h.poll();
    await h.settled();
    expect(h.call(3).body).toMatchObject({ after: 'c1' });
    expect(h.c.session()?.cursor).toBe('c3');
    expect(h.c.session()?.comments[0]).toMatchObject({ id: 'a', status: 'kept', overruled: true });
  });

  it('a retried send reuses the batch id', async () => {
    const h = await opened();
    const batchOf = (i: number) => (h.call(i).body.batch as { id: string }).id;
    h.queue.push(offline);
    const lost = await h.c.send([mark]);
    expect(lost).toMatchObject({ ok: false, reason: 'network', batchId: batchOf(1) });

    h.queue.push(reply(502, { code: 'file_failed' }));
    const again = await h.c.send([mark], lost.batchId);
    expect(again).toMatchObject({ ok: false, code: 'file_failed', batchId: lost.batchId });
    expect(batchOf(2)).toBe(lost.batchId);

    h.queue.push(reply(202, { v: 1, batchId: lost.batchId, accepted: ['c-1'], trimmed: [] }));
    expect(await h.c.send([mark], again.batchId)).toEqual({
      ok: true,
      ids: ['c-1'],
      trimmed: [false],
      batchId: lost.batchId,
    });
    expect(batchOf(3)).toBe(lost.batchId);

    h.queue.push(offline);
    const fresh = await h.c.send([mark]);
    expect(fresh.batchId).not.toBe(lost.batchId);
    expect(batchOf(4)).toBe(fresh.batchId);
  });

  it('flushes before send back and reuses the finish id on explicit retries', async () => {
    const h = await opened();
    expect(h.c).not.toHaveProperty('pass');
    const checks = [{ comment: 'a', verdict: 'fixed' as const }];
    h.queue.push(offline);
    expect(await h.c.finish(checks)).toMatchObject({ ok: false, reason: 'network' });
    expect(h.flushFn.mock.invocationCallOrder[0]).toBeLessThan(
      h.fetchFn.mock.invocationCallOrder[1] as number,
    );
    const { url, init, body } = h.call(1);
    expect(url).toBe(`${ENDPOINT}/review/finish`);
    expect(init.credentials).toBe('omit');
    const finish_id = body.finish_id;
    expect(body).toEqual({ v: 1, review: ID, finish: 'send_back', finish_id, checks });
    expect(h.fetchFn).toHaveBeenCalledTimes(2);

    h.queue.push(reply(409, { code: 'review_held', comments: ['b'] }));
    expect(await h.c.finish()).toMatchObject({ code: 'review_held', comments: ['b'] });
    expect(h.call(2).body).toEqual({ v: 1, review: ID, finish: 'send_back', finish_id });
    h.queue.push(unreadable, reply(200, { v: 1, summary: 'nope' }));
    expect(await h.c.finish()).toMatchObject({ ok: false, reason: 'rejected' });
    expect(await h.c.finish()).toMatchObject({ ok: false, reason: 'rejected' });
    expect(h.c.session()).toBeDefined();
    expect(h.data.get(REVIEW_STORAGE_KEY)).toBe(ID);

    const summary = [{ label: 'Commentaires', value: '2' }];
    h.queue.push(reply(200, { v: 1, summary }));
    const results = await Promise.all([h.c.finish(), h.c.finish()]);
    expect(results).toEqual([
      { ok: true, summary },
      { ok: true, summary },
    ]);
    expect(h.fetchFn).toHaveBeenCalledTimes(6);
    expect(h.call(5).body.finish_id).toBe(finish_id);
    expect(h.data.has(REVIEW_STORAGE_KEY)).toBe(false);
    expect(h.timers.size).toBe(0);
    expect(await h.c.send([mark])).toMatchObject({ ok: false, code: 'review_finished' });
    expect(h.fetchFn).toHaveBeenCalledTimes(6);
  });

  it('retains failed comments and stops on terminal mutation refusals', async () => {
    const broken = async (): Promise<boolean> => {
      throw new Error('flush broke');
    };
    for (const flush of [async () => false, broken]) {
      const f = await opened(undefined, flush);
      expect(await f.c.finish()).toMatchObject({ ok: false, code: 'flush_failed' });
      expect(f.fetchFn).toHaveBeenCalledOnce();
      expect(f.data.get(REVIEW_STORAGE_KEY)).toBe(ID);
    }

    const h = await opened();
    const payloads = [mark];
    h.queue.push(reply(502, { code: 'file_failed' }), offline);
    expect(await h.c.send(payloads)).toMatchObject({ ok: false, code: 'file_failed' });
    expect(await h.c.send(payloads)).toMatchObject({ ok: false, reason: 'network' });
    expect(payloads).toEqual([mark]);
    expect(h.c.session()).toBeDefined();
    expect(h.timers.size).toBe(1);
    expect(h.data.get(REVIEW_STORAGE_KEY)).toBe(ID);

    const ops = [
      (x: ReviewClient) => x.send([mark]),
      (x: ReviewClient) => x.overrule('a', 'k'),
      (x: ReviewClient) => x.finish(),
    ];
    for (const [status, code] of [
      [404, 'review_not_found'],
      [409, 'review_finished'],
      [410, 'review_expired'],
    ] as const) {
      for (const op of ops) {
        const t = await opened();
        t.queue.push(reply(status, { code }));
        expect(await op(t.c)).toMatchObject({ ok: false, code });
        expect(t.data.has(REVIEW_STORAGE_KEY)).toBe(false);
        expect(t.timers.size).toBe(0);
        expect(t.c.session()).toBeUndefined();
        expect(t.updates.at(-1)).toEqual({ kind: 'ended', code });
        expect(await t.c.send([mark])).toMatchObject({ ok: false, code });
        expect(t.fetchFn).toHaveBeenCalledTimes(2);
      }
    }
  });
});
