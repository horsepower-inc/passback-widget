import { describe, expect, it, vi } from 'vitest';
import { REVIEW_STORAGE_KEY } from './review-link';
import { createReviewSession, type ReviewComment, type ReviewSession } from './review-session';

const ID = 'abcdefghijklmnopqrstuv2345';
const ENDPOINT = 'https://relay.test/v1/ingest/site-1';

const comment = (id: string, text = id): ReviewComment => ({
  id,
  mark: `m-${id}`,
  text,
  label: null,
  status: 'open',
  tone: 'plain',
  overruled: false,
});
const session = (fields: Partial<ReviewSession> = {}): ReviewSession => ({
  v: 1,
  state: 'open',
  title: 'Revue',
  version: 'rc1',
  round: 1,
  check: 'Ça marche ?',
  labels: [{ key: 'k', label: 'Plus tard' }],
  finish: [{ key: 'send_back', label: 'Renvoyer', enabled: true }],
  featureUrl: 'https://track.test/feature',
  expiresAt: '2026-11-03T00:00:00Z',
  cursor: 'c1',
  comments: [],
  ...fields,
});
const reply = (status: number, body: unknown) =>
  ({ ok: status < 300, status, json: async () => body }) as Response;
const unreadable = {
  ok: true,
  status: 200,
  json: () => Promise.reject(new SyntaxError('not json')),
} as Response;
const offline = new TypeError('offline');
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function harness(hash = `#pb-review${ID}`, denied = false) {
  const data = new Map<string, string>();
  const refuse = () => {
    throw new Error('denied');
  };
  const sessionStorage = {
    getItem: denied ? refuse : (k: string) => data.get(k) ?? null,
    setItem: denied ? refuse : vi.fn((k: string, v: string) => void data.set(k, v)),
    removeItem: denied ? refuse : (k: string) => void data.delete(k),
  };
  const queue: unknown[] = [];
  const fetchFn = vi.fn<typeof fetch>(async () => {
    const next = await queue.shift();
    if (next instanceof Error) throw next;
    return next as Response;
  });
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 0;
  const state = { visible: true, open: true };
  const updates: unknown[] = [];
  const client = () =>
    createReviewSession({
      win: { location: { hash }, sessionStorage } as never,
      endpoint: ENDPOINT,
      fetchFn,
      state: () => state,
      flush: async () => true,
      setTimer: (run, ms) => (timers.set(++nextTimer, { run, ms }), nextTimer),
      clearTimer: (handle) => void timers.delete(handle as number),
      onUpdate: (update) => updates.push(update),
    });
  const fire = async (next: unknown) => {
    queue.push(next);
    const [entry] = [...timers];
    timers.delete(entry?.[0] as number);
    entry?.[1].run();
    await settle();
  };
  const sent = (i: number) => JSON.parse(fetchFn.mock.calls[i]?.[1]?.body as string) as object;
  const delays = () => [...timers.values()].map((timer) => timer.ms);
  return { data, sessionStorage, queue, fetchFn, state, updates, client, fire, sent, delays };
}

describe('review session client', () => {
  it('reads and merges review changes on the open and hidden cadences', async () => {
    const h = harness();
    h.queue.push(reply(200, session({ comments: [comment('a'), comment('b')] })));
    const c = h.client();
    await settle();
    const [url, init] = h.fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ENDPOINT}/review/read`);
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit' });
    expect(h.sent(0)).toEqual({ v: 1, review: ID });
    expect(h.delays()).toEqual([15_000]);

    const fixes = [{ comment: 'a', text: 'corrigé', line: 'L12' }];
    const comments = [comment('a', 'nouveau <b>texte</b>'), comment('c')];
    await h.fire(reply(200, session({ cursor: 'c2', title: 'Revue 2', fixes, comments })));
    expect(h.sent(1)).toEqual({ v: 1, review: ID, after: 'c1' });
    expect(c.session()).toMatchObject({ title: 'Revue 2', cursor: 'c2', fixes });
    expect(c.session()?.comments.map((x) => x.text)).toEqual(['nouveau <b>texte</b>', 'b', 'c']);
    expect(h.updates.at(-1)).toEqual({ kind: 'session', session: c.session() });

    for (const [visible, open, delays] of [
      [false, true, [60_000]],
      [false, false, [60_000]],
      [true, false, []],
      [true, true, [15_000]],
    ] as const) {
      Object.assign(h.state, { visible, open });
      c.stateChanged();
      expect(h.delays()).toEqual(delays);
    }

    let answer: (value: unknown) => void = () => undefined;
    await h.fire(new Promise((resolve) => (answer = resolve)));
    h.state.visible = false;
    c.stateChanged();
    expect(h.delays()).toEqual([]);
    expect(h.fetchFn).toHaveBeenCalledTimes(3);
    answer(reply(200, session({ cursor: 'c3' })));
    await settle();
    expect(h.delays()).toEqual([60_000]);
    expect(h.sessionStorage.setItem).toHaveBeenCalledOnce();
    expect(h.sessionStorage.setItem).toHaveBeenCalledWith(REVIEW_STORAGE_KEY, ID);
  });

  it('keeps absent and unread review sessions inactive', async () => {
    const absent = harness('');
    const none = absent.client();
    none.stateChanged();
    const inactive = { ok: false, code: 'review_inactive' };
    expect(await none.send([])).toMatchObject(inactive);
    expect(await none.overrule('a', 'k')).toMatchObject(inactive);
    expect(await none.finish()).toMatchObject(inactive);
    expect(none.session()).toBeUndefined();
    expect(absent.fetchFn).not.toHaveBeenCalled();
    expect(absent.delays()).toEqual([]);
    expect(absent.updates).toEqual([]);

    const unread = harness();
    unread.queue.push(new Promise(() => undefined));
    const pending = unread.client();
    expect(await pending.send([])).toMatchObject(inactive);
    expect(unread.fetchFn).toHaveBeenCalledOnce();
  });

  it('contains read failures and ignores responses after disposal', async () => {
    const logged = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m));
    const h = harness();
    h.queue.push(offline);
    const c = h.client();
    await settle();
    expect(h.updates.at(-1)).toMatchObject({ kind: 'failure', failure: { reason: 'network' } });
    const invalid = session({ comments: [{ id: 'a' } as ReviewComment] });
    for (const bad of [unreadable, reply(200, { v: 1 }), reply(200, invalid), reply(500, null)]) {
      await h.fire(bad);
      expect(h.sent(h.fetchFn.mock.calls.length - 1)).toEqual({ v: 1, review: ID });
      expect(c.session()).toBeUndefined();
      expect(h.delays()).toEqual([15_000]);
    }

    await h.fire(reply(200, session({ comments: [comment('a')] })));
    const kept = c.session();
    for (const bad of [
      unreadable,
      offline,
      reply(404, null),
      reply(502, { code: 'file_failed' }),
    ]) {
      await h.fire(bad);
      expect(c.session()).toBe(kept);
      expect(h.sent(h.fetchFn.mock.calls.length - 1)).toMatchObject({ after: 'c1' });
      expect(h.delays()).toEqual([15_000]);
    }

    let answer: (value: unknown) => void = () => undefined;
    await h.fire(new Promise((resolve) => (answer = resolve)));
    c.dispose();
    const seen = h.updates.length;
    answer(reply(410, { code: 'review_expired' }));
    await settle();
    expect(h.updates).toHaveLength(seen);
    expect(h.data.has(REVIEW_STORAGE_KEY)).toBe(true);
    c.stateChanged();
    expect(h.delays()).toEqual([]);
    expect(await c.send([])).toMatchObject({ ok: false, code: 'review_inactive' });

    const hostile = createReviewSession({
      win: { location: { hash: `#pb-review${ID}` }, sessionStorage: h.sessionStorage } as never,
      endpoint: ENDPOINT,
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(reply(200, session())),
      flush: async () => true,
      state: () => {
        throw new Error('host input');
      },
      onUpdate: () => {
        throw new Error('host listener');
      },
    });
    await settle();
    expect(hostile.session()?.cursor).toBe('c1');
    for (const spy of logged) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('tries the first read again on the poll cadence while no session was read and no panel is open', async () => {
    const h = harness();
    h.state.open = false;
    h.queue.push(offline);
    const c = h.client();
    await settle();
    expect(h.delays()).toEqual([15_000]);
    for (const bad of [reply(500, null), unreadable]) {
      await h.fire(bad);
      expect(h.sent(h.fetchFn.mock.calls.length - 1)).toEqual({ v: 1, review: ID });
      expect(h.delays()).toEqual([15_000]);
    }

    h.state.visible = false;
    c.stateChanged();
    expect(h.delays()).toEqual([60_000]);
    h.state.visible = true;

    const sessions = () => h.updates.filter((u) => (u as { kind: string }).kind === 'session');
    await h.fire(reply(200, session()));
    expect(c.session()?.cursor).toBe('c1');
    expect(sessions()).toHaveLength(1);
    expect(h.delays()).toEqual([]);

    const gone = harness();
    gone.state.open = false;
    gone.queue.push(offline);
    gone.client();
    await settle();
    await gone.fire(reply(410, { code: 'review_expired' }));
    expect(gone.delays()).toEqual([]);
    expect(gone.data.has(REVIEW_STORAGE_KEY)).toBe(false);

    const expired = harness();
    expired.state.open = false;
    expired.queue.push(reply(410, { code: 'review_expired' }));
    expired.client();
    expect(expired.data.has(REVIEW_STORAGE_KEY)).toBe(true);
    await settle();
    expect(expired.fetchFn).toHaveBeenCalledTimes(1);
    expect(expired.delays()).toEqual([]);
    expect(expired.data.has(REVIEW_STORAGE_KEY)).toBe(false);

    const off = harness();
    off.state.open = false;
    off.queue.push(offline);
    const d = off.client();
    await settle();
    expect(off.delays()).toEqual([15_000]);
    d.dispose();
    expect(off.delays()).toEqual([]);
    d.stateChanged();
    expect(off.delays()).toEqual([]);
  });

  it('clears terminal review ids even when storage is denied', async () => {
    for (const [status, code] of [
      [404, 'review_not_found'],
      [409, 'review_finished'],
      [410, 'review_expired'],
    ] as const) {
      for (const denied of [false, true]) {
        const h = harness(undefined, denied);
        h.queue.push(reply(200, session()));
        const c = h.client();
        await settle();
        await h.fire(reply(status, { code }));
        expect(h.data.has(REVIEW_STORAGE_KEY)).toBe(false);
        expect(h.updates.at(-1)).toEqual({ kind: 'ended', code });
        expect(c.session()).toBeUndefined();
        expect(await c.send([])).toMatchObject({ ok: false, code });
        c.stateChanged();
        expect(h.delays()).toEqual([]);
        expect(h.fetchFn).toHaveBeenCalledTimes(2);
      }
    }

    const old = harness();
    old.queue.push(reply(404, null));
    old.client();
    await settle();
    expect(old.updates).toEqual([{ kind: 'ended', code: 'review_not_found' }]);
    expect(old.data.has(REVIEW_STORAGE_KEY)).toBe(false);
    expect(old.delays()).toEqual([]);
  });
});
