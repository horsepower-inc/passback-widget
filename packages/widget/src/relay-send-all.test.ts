// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keptReducer } from './kept';
import { createOverlay, type Overlay, type SubmitDetail } from './overlay';
import { RELAY_SENDING } from './relay-send-feedback';
import { sendAll } from './send-all';
import { sendBatch, type BatchOutcome, type SubmitAllDetail } from './send-batch';
import type { Screenshot } from '@passback/schema';
import { loadShotOpen, type ShotSession } from './shot-loader';
import { createShotStep } from './shot-step';
import { uploadShot } from './shot-upload';
import { CLASS } from './styles';
import { TRAY_CLASS } from './tray-view';

vi.mock('./shot-loader', async (original) => ({
  ...(await original<typeof import('./shot-loader')>()),
  loadShotOpen: vi.fn(),
}));

const scope = globalThis as { __passback?: unknown };
let overlays: Overlay[] = [];
let captured: { state: { kept: Parameters<typeof keptReducer>[0] } };

beforeEach(async () => {
  vi.useFakeTimers();
  await document.fonts?.ready;
});
afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  delete scope.__passback;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

type Opts = { relay?: () => boolean; onBatch?: (detail: SubmitAllDetail) => void };
function setup({ relay, onBatch }: Opts = {}) {
  scope.__passback = { fx: { addons: [sendAll, (ctx: typeof captured) => (captured = ctx)] } };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const batches: SubmitAllDetail[] = [];
  host.addEventListener('passback:submit-all', (event) => {
    const detail = (event as CustomEvent<SubmitAllDetail>).detail;
    batches.push(detail);
    onBatch?.(detail);
  });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn<(detail: SubmitDetail) => void>(),
    drawing: { toggle: vi.fn(), cancel: vi.fn() },
    relay,
  });
  overlays.push(overlay);
  return { host, root, overlay, batches };
}
type R = ReturnType<typeof setup>;

function keepAll(r: R, ...texts: string[]): void {
  r.overlay.arm();
  for (const text of texts) {
    const target = document.body.appendChild(document.createElement('div'));
    target.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
    );
    const input = r.root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    r.root.querySelector<HTMLElement>('[data-role="add-more"]')!.click();
  }
}
const toTracker = (...ns: number[]): void => {
  for (const n of ns)
    captured.state.kept = keptReducer(captured.state.kept, { type: 'dest', n, dest: 'tracker' });
};
const send = (r: R, dest?: 'tracker' | 'agent'): void => {
  r.host.dispatchEvent(new CustomEvent('passback:send-all', { detail: dest ? { dest } : null }));
};
const rows = (r: R): string[] =>
  [...r.root.querySelectorAll(`.${TRAY_CLASS.tray} .pb-list li`)].map((li) => li.textContent ?? '');
const dots = (r: R): HTMLElement[] => [...r.root.querySelectorAll<HTMLElement>(`.${CLASS.dot}`)];
const ball = (r: R): HTMLElement => r.root.querySelector<HTMLElement>(`.${CLASS.launcher}`)!;
const stamps = (r: R): number => r.root.querySelectorAll('.pb-stamp').length;
const retry = (r: R): HTMLElement | undefined =>
  [...r.root.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Retry');
const gone = (el: HTMLElement): boolean => el.hasAttribute('data-pb-relay-gone');
const ok = (n: number, relay = true): BatchOutcome => ({
  ok: true,
  ids: Array.from({ length: n }, (_, i) => `t${i}`),
  trimmed: Array<boolean>(n).fill(false),
  notes: Array<string | undefined>(n).fill(undefined),
  relay,
});

describe('relay Send all at the ball', () => {
  it('hides only the relay batch before capture starts', () => {
    const seen: { gone: boolean[]; rows: string[]; sending: boolean }[] = [];
    const r: R = setup({
      relay: () => true,
      // The listener runs where capture would begin: the batch must already be away.
      onBatch: () =>
        seen.push({
          gone: dots(r).map(gone),
          rows: rows(r),
          sending: ball(r).hasAttribute(RELAY_SENDING),
        }),
    });
    keepAll(r, 'one', 'two', 'three');
    toTracker(1, 2);
    send(r, 'tracker');
    expect(r.batches).toHaveLength(1);
    expect(seen[0]!.gone).toEqual([true, true, false]);
    expect(seen[0]!.rows).toHaveLength(1);
    expect(seen[0]!.rows[0]).toContain('three');
    expect(seen[0]!.sending).toBe(true);
    expect(ball(r).hasAttribute('hidden')).toBe(false);
  });

  it('celebrates an acknowledged relay batch once at the launcher', () => {
    const r = setup({ relay: () => true });
    keepAll(r, 'one', 'two');
    send(r);
    r.batches[0]!.settle(ok(2));
    r.batches[0]!.settle(ok(2));
    expect(stamps(r)).toBe(1);
    expect(ball(r).hasAttribute(RELAY_SENDING)).toBe(false);
    expect(dots(r).every(gone)).toBe(true);
    expect(rows(r)).toEqual([]);
    expect(r.overlay.phase()).toBe('idle');
  });

  it('retries every kept relay comment with the same batch picture', async () => {
    const flush = async (): Promise<void> => void (await vi.advanceTimersByTimeAsync(0));
    // Capture and upload are both held open: the ball must stay sending through each.
    const defer = <T>(): { promise: Promise<T>; done: (value: T) => void } => {
      let done!: (value: T) => void;
      return { promise: new Promise<T>((resolve) => (done = resolve)), done };
    };
    const captures: ReturnType<typeof defer<void>>[] = [];
    const uploads: ReturnType<typeof defer<Response>>[] = [];
    const pictures: Screenshot[] = [];
    const upFetch = vi.fn<typeof fetch>(() => (uploads.push(defer()), uploads.at(-1)!.promise));
    let uploadUrl = '';
    const finish = vi.fn<ShotSession['finish']>(async (_el, _d, opts) => {
      if (opts?.picture === false) return {};
      captures.push(defer());
      await captures.at(-1)!.promise;
      const blob = new Blob(['x']);
      const up = await uploadShot({
        url: uploadUrl,
        blob,
        mime: 'image/png',
        width: 1,
        height: 1,
        masked: 0,
        fetchFn: upFetch,
      });
      if (!up.ok) return {};
      pictures.push(up.screenshot);
      return { screenshot: up.screenshot };
    });
    const created = (id: string): Response =>
      new Response(JSON.stringify({ id: id.repeat(32) }), { status: 201 });
    const probe = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{}'));
    document.head.innerHTML =
      '<script data-passback-screenshots="true" data-passback-endpoint="/e" data-passback-shot="/s.js"></script>';
    const made: ShotSession = { setActive: vi.fn(), count: () => 0, finish, close: vi.fn() };
    vi.mocked(loadShotOpen).mockResolvedValue((o) => ((uploadUrl = o.uploadUrl), made));
    const r = setup({ relay: () => true });
    const step = createShotStep({
      doc: document,
      win: window,
      root: r.root,
      host: r.host,
      onLoadFailed: vi.fn(),
    });
    let release!: (value: unknown) => void;
    const sendOf = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('again'))
      .mockImplementationOnce(() => new Promise((done) => (release = done)));
    const collector = { relay: true, sendBatch: sendOf };
    let loaded!: (value: typeof collector) => void;
    const load = new Promise<typeof collector>((done) => (loaded = done));
    r.host.addEventListener('passback:submit-all', (event) => {
      void sendBatch((event as CustomEvent<SubmitAllDetail>).detail, () => load, step);
    });
    keepAll(r, 'one', 'two');
    send(r);
    await flush();
    // Deferred capture: the batch is away and the ball is sending.
    expect(captures).toHaveLength(1);
    expect(upFetch).not.toHaveBeenCalled();
    expect(ball(r).hasAttribute(RELAY_SENDING)).toBe(true);
    expect(rows(r)).toEqual([]);
    captures[0]!.done();
    await flush();
    // Deferred upload: still sending, nothing reaches the collector yet.
    expect(upFetch).toHaveBeenCalledWith(
      '/e/screenshots',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(ball(r).hasAttribute(RELAY_SENDING)).toBe(true);
    expect(rows(r)).toEqual([]);
    uploads[0]!.done(created('a'));
    await flush();
    // Deferred collector load and ingest: still sending.
    expect(sendOf).not.toHaveBeenCalled();
    expect(ball(r).hasAttribute(RELAY_SENDING)).toBe(true);
    expect(rows(r)).toEqual([]);
    loaded(collector);
    await flush();
    expect(r.root.textContent!.match(/boom/g)).toHaveLength(1);
    expect(ball(r).hasAttribute(RELAY_SENDING)).toBe(false);
    expect(rows(r)).toHaveLength(2);
    const first = r.batches[0]!.details;
    retry(r)!.click();
    await flush();
    expect(r.batches[1]!.details).toBe(first);
    first.forEach((d, i) => expect(r.batches[1]!.details[i]).toBe(d));
    // The retried batch carries the very same picture object, not a copy of it.
    const shotOf = (call: number): unknown => sendOf.mock.calls[call]![0][0].extra.screenshot;
    expect(pictures).toHaveLength(1);
    expect(shotOf(0)).toBe(pictures[0]);
    expect(shotOf(1)).toBe(pictures[0]);
    expect(finish).toHaveBeenCalledTimes(2);
    expect(upFetch).toHaveBeenCalledTimes(1);
    // A changed batch drops the reuse: the deleted comment is not sent again.
    r.root.querySelector<HTMLElement>('[aria-label="Delete comment 2"]')!.click();
    retry(r)!.click();
    await flush();
    captures[1]!.done();
    await flush();
    uploads[1]!.done(created('b'));
    await flush();
    expect(r.batches[2]!.details).not.toBe(first);
    expect(sendOf.mock.calls[2]![0].map((i: { comment: string }) => i.comment)).toEqual(['one']);
    expect(pictures).toHaveLength(2);
    expect(shotOf(2)).toBe(pictures[1]);
    expect(shotOf(2)).not.toBe(pictures[0]);
    expect(ball(r).hasAttribute(RELAY_SENDING)).toBe(true);
    release({ ok: true, ids: ['t0'], trimmed: [false] });
    await flush();
    expect(stamps(r)).toBe(1);
    expect(ball(r).hasAttribute(RELAY_SENDING)).toBe(false);
    probe.mockRestore();
  });

  it('treats tracker batches as relay and preserves local batches', () => {
    const local = setup();
    keepAll(local, 'one');
    send(local);
    expect(gone(dots(local)[0]!)).toBe(false);
    expect(ball(local).hasAttribute(RELAY_SENDING)).toBe(false);
    local.batches[0]!.settle(ok(1, false));
    expect(stamps(local)).toBe(0);
    const tracker = setup();
    keepAll(tracker, 'one');
    toTracker(1);
    send(tracker, 'tracker');
    expect(gone(dots(tracker)[0]!)).toBe(true);
    expect(ball(tracker).hasAttribute(RELAY_SENDING)).toBe(true);
    tracker.batches[0]!.settle(ok(1));
    expect(stamps(tracker)).toBe(1);
  });

  it('preserves batch failure cleanup and ignores late settlement', () => {
    const r = setup({ relay: () => true });
    keepAll(r, 'one', 'two');
    send(r);
    r.batches[0]!.settle({ ok: false, message: 'boom' });
    for (const n of [2, 1])
      r.root.querySelector<HTMLElement>(`[aria-label="Delete comment ${n}"]`)!.click();
    expect(r.overlay.phase()).toBe('idle');
    expect(ball(r).hasAttribute(RELAY_SENDING)).toBe(false);
    // Deleting the last failed relay comment ends the send and keeps an unrelated comment.
    const u = setup();
    keepAll(u, 'a', 'b');
    toTracker(1);
    send(u, 'tracker');
    u.batches[0]!.settle({ ok: false, message: 'boom' });
    u.root.querySelector<HTMLElement>('[aria-label="Delete comment 1"]')!.click();
    expect(ball(u).hasAttribute(RELAY_SENDING)).toBe(false);
    expect(u.overlay.phase()).toBe('idle');
    expect(rows(u)).toHaveLength(1);
    const d = setup({ relay: () => true });
    keepAll(d, 'one');
    send(d);
    d.host.dispatchEvent(new Event('passback:dispose'));
    d.batches[0]!.settle(ok(1));
    expect(stamps(d)).toBe(0);
  });
});
