import type { Bubble } from './bubble-view';
import { destOf, keptReducer, type Dest } from './kept';
import { keptOffset } from './inbox-numbers';
import { showLauncher, type Launcher } from './launcher';
import { dispatch } from './overlay-draw';
import type { KeptPin } from './overlay-marks';
import type { SubmitCtx, SubmitDetail, SubmitMark } from './overlay-submit';
import { enterPhase } from './phase';
import { reviewFlush } from './review-flush';
import type { BatchOutcome, SubmitAllDetail } from './send-batch';

export type SendAllCtx = SubmitCtx & {
  root: ShadowRoot;
  leaveArmed(): void;
  launcher: Launcher;
  panel: { refresh(): void; reveal?(): void };
};

export type Filed = { comment: string; ref: string };
type Scope = { __passback?: Record<string, unknown> };

function renumber(items: readonly KeptPin[], offset: number): void {
  for (const [i, { mark }] of items.entries()) {
    mark.dot.setNumber(offset + i + 1);
    mark.dot.element.dataset.n = String(offset + i + 1);
  }
}

/** Publishes window.__passback.filed over the list; the returned function removes it if it is still ours. */
function publishFiled(win: Window, list: readonly Filed[]): () => void {
  const scope = win as unknown as Scope;
  const getter = (): readonly Filed[] => list.slice();
  scope.__passback = Object.assign(scope.__passback ?? {}, { filed: getter });
  return () => {
    if (scope.__passback?.filed === getter) delete scope.__passback.filed;
  };
}

function showSent(
  root: ShadowRoot,
  items: readonly KeptPin[],
  outcome: Extract<BatchOutcome, { ok: true }>,
  atBall: boolean,
): void {
  const next = outcome.relay ? 'sent' : 'queued';
  for (const [i, { mark }] of items.entries()) {
    const id = outcome.ids[i]!;
    mark.id = id;
    mark.lastState = next;
    if (atBall) continue;
    mark.dot.setState(next);
    root.append(mark.bubble.element);
    if (outcome.relay) mark.bubble.showSent();
    else mark.bubble.showAcked(id, outcome.trimmed[i] ?? false);
    const note = outcome.notes[i];
    if (note !== undefined) mark.bubble.showNote(note);
  }
}

// A relay batch ends at the ball; anything else gives its marks their own presentation back.
function presentSent(
  ctx: SendAllCtx,
  items: readonly KeptPin[],
  outcome: Extract<BatchOutcome, { ok: true }>,
  relayed: Bubble | null,
): void {
  const first = items[0]?.mark;
  const feedback = ctx.relayFeedback;
  const atBall = relayed === first?.bubble && outcome.relay && feedback?.owns(relayed) === true;
  if (atBall) feedback!.sent(first!);
  else feedback?.release(relayed);
  showSent(ctx.root, items, outcome, atBall);
}

function presentFailed(
  ctx: SendAllCtx,
  items: readonly KeptPin[],
  relayed: Bubble | null,
  { message, retry }: { message: string; retry: () => void },
): void {
  const first = items[0];
  for (const { mark } of items) mark.dot.setState('failed');
  if (first === undefined || ctx.relayFeedback?.error(relayed, message, retry) === true) return;
  ctx.root.append(first.mark.bubble.element);
  first.mark.bubble.showError(message, retry);
}

function askedDest(event: Event): Dest {
  return (event as CustomEvent<{ dest?: Dest } | null>).detail?.dest === 'tracker'
    ? 'tracker'
    : 'agent';
}

function detailsOf(
  items: readonly KeptPin[],
  all: readonly KeptPin[],
  offset: number,
): (SubmitDetail & { mark: object })[] {
  return items.map((item, index) => ({
    mark: item.mark,
    comment: item.comment,
    selector: item.selector,
    offset: item.offset,
    element: item.element,
    marks: items.map((entry, i): SubmitMark => ({
      element: entry.element,
      offset: entry.offset,
      n: offset + all.indexOf(entry) + 1,
      current: i === index,
    })),
  }));
}

function markSending(ctx: SendAllCtx, items: readonly KeptPin[], relay: boolean): void {
  for (const { mark } of items) {
    mark.dot.setState('sending');
    mark.bubble.setPending();
  }
  const [first, ...rest] = items;
  if (first === undefined) return;
  ctx.root.append(first.mark.bubble.element);
  // A relay batch leaves its own marks and rows at once; the ball shows the send.
  if (relay)
    ctx.relayFeedback?.sending(
      first.mark,
      rest.map((item) => item.mark),
    );
}

type Batch = ReturnType<typeof detailsOf>;

const sameBatch = (a: Batch, b: Batch): boolean =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.mark === b[i]!.mark &&
      x.element === b[i]!.element &&
      x.comment === b[i]!.comment &&
      x.selector === b[i]!.selector &&
      x.offset.x === b[i]!.offset.x &&
      x.offset.y === b[i]!.offset.y &&
      x.marks?.length === b[i]!.marks?.length &&
      x.marks?.every((m, j) => {
        const n = b[i]!.marks![j]!;
        return m.element === n.element && m.n === n.n && m.current === n.current;
      }),
  );

// The details of a failed batch: an unchanged Retry hands the same objects on, so the shot step reuses its picture.
function createKeeper() {
  let kept: { dest: Dest; details: Batch } | undefined;
  return {
    take(dest: Dest, fresh: Batch): Batch {
      if (kept?.dest !== dest || !sameBatch(kept.details, fresh)) kept = { dest, details: fresh };
      return kept.details;
    },
    drop: (): void => void (kept = undefined),
  };
}

function sendable(state: SendAllCtx['state'], batch: string): boolean {
  const { flow } = state;
  return (
    batch !== 'pending' &&
    (flow === 'armed' || flow === 'idle' || (batch === 'failed' && flow === 'sending')) &&
    state.kept.items.length > 0
  );
}

/** The answer to a `passback:batch-size` event: the event's detail gets `n`, the size of the batch a Send all click sends. */
export type BatchSizeDetail = { n: number };

// The notch asks how many comments one click on its Send all sends: the batch start('agent') builds, or none.
function answerSize(event: Event, n: number): void {
  const detail = (event as CustomEvent<BatchSizeDetail | null>).detail;
  if (detail) detail.n = n;
}

const inBatch =
  (dest: Dest) =>
  (item: KeptPin): boolean =>
    destOf(item) === dest;

// A relay batch is over once every comment it sent is deleted; unrelated comments stay kept.
const left = (kept: readonly KeptPin[], sent: readonly KeptPin[] | null): number =>
  sent === null ? kept.length : sent.filter((item) => kept.includes(item)).length;

/** Collector-chunk add-on: Send all hands every kept comment to the host as one batch and settles it with one outcome. */
export function sendAll(ctx: SendAllCtx): void {
  const { host, state } = ctx;
  const win = ctx.root.ownerDocument.defaultView ?? ({} as Window);
  const filed: Filed[] = [];
  const unpublish = publishFiled(win, filed);
  let batch: 'rest' | 'pending' | 'failed' = 'rest';
  let disposed = false;
  const retained = createKeeper();
  // The bubble the ball is showing a relay batch for, while one is in flight or failed.
  let relayed: Bubble | null = null;
  let inflight: readonly KeptPin[] = [];
  const open = (): boolean => host.getAttribute('data-pb-panel') === 'open';
  const ready = (): boolean => open() && sendable(state, batch);
  const succeed = (
    items: readonly KeptPin[],
    dest: Dest,
    outcome: Extract<BatchOutcome, { ok: true }>,
  ): void => {
    presentSent(ctx, items, outcome, relayed);
    relayed = null;
    batch = 'rest';
    retained.drop();
    dispatch(ctx, 'acked');
    state.kept = keptReducer(state.kept, { type: 'clear', dest });
    if (dest === 'tracker')
      for (const [i, { comment }] of items.entries()) filed.push({ comment, ref: outcome.ids[i]! });
    renumber(state.kept.items, keptOffset(win));
    ctx.launcher.update(state.marks);
    ctx.panel.refresh();
  };
  const fail = (items: readonly KeptPin[], dest: Dest, message: string): void => {
    batch = 'failed';
    inflight = items;
    presentFailed(ctx, items, relayed, { message, retry: ctx.guard(() => start(dest)) });
    ctx.panel.refresh();
  };
  function start(dest: Dest): void {
    if (!ready()) return;
    const all = state.kept.items;
    const items = all.filter(inBatch(dest));
    if (items.length === 0) return;
    if (batch !== 'failed') {
      if (state.flow === 'idle') dispatch(ctx, 'arm');
      ctx.leaveArmed();
      if (!dispatch(ctx, 'pin')) return;
    }
    dispatch(ctx, 'send');
    batch = 'pending';
    const relay = ctx.relay?.() === true || dest === 'tracker';
    relayed = relay && ctx.relayFeedback !== undefined ? items[0]!.mark.bubble : null;
    markSending(ctx, items, relayed !== null);
    ctx.panel.refresh();
    let settled = false;
    const settle = ctx.guard((outcome: BatchOutcome): void => {
      if (settled || disposed) return;
      settled = true;
      if (outcome.ok) succeed(items, dest, outcome);
      else fail(items, dest, outcome.message);
    });
    const detail: SubmitAllDetail = {
      details: retained.take(dest, detailsOf(items, all, keptOffset(win))),
      dest,
      settle,
    };
    host.dispatchEvent(new CustomEvent('passback:submit-all', { detail, bubbles: false }));
  }
  const flush = reviewFlush(ctx, { batch: () => batch, open, start });
  const sized = (event: Event): void =>
    answerSize(event, ready() ? state.kept.items.filter(inBatch('agent')).length : 0);
  const asked = (event: Event): unknown => flush.take(event) || start(askedDest(event));
  // Deleting the last comment of a failed batch ends the send, as for a failed single send.
  const emptied = (): void => {
    if (batch !== 'failed' || state.flow !== 'sending') return;
    if (left(state.kept.items, relayed === null ? null : inflight) > 0) return;
    batch = 'rest';
    retained.drop();
    ctx.relayFeedback?.release(relayed);
    relayed = null;
    state.flow = 'idle';
    enterPhase(state, host, 'idle');
    showLauncher(ctx.launcher, state.marks);
  };
  const listeners: [string, (event: Event) => void][] = [
    ['passback:send-all', ctx.guard(asked)],
    ['passback:batch-size', sized],
    ['passback:sync', ctx.guard(() => (flush.wake(), emptied()))],
    [
      'passback:dispose',
      () => (
        listeners.forEach(([type, fn]) => host.removeEventListener(type, fn)),
        (disposed = true),
        retained.drop(),
        flush.stop(),
        unpublish()
      ),
    ],
  ];
  listeners.forEach(([type, fn]) => host.addEventListener(type, fn));
}
