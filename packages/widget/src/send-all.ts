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
): void {
  const next = outcome.relay ? 'sent' : 'queued';
  for (const [i, { mark }] of items.entries()) {
    const id = outcome.ids[i]!;
    mark.id = id;
    mark.lastState = next;
    mark.dot.setState(next);
    root.append(mark.bubble.element);
    if (outcome.relay) mark.bubble.showSent();
    else mark.bubble.showAcked(id, outcome.trimmed[i] ?? false);
    const note = outcome.notes[i];
    if (note !== undefined) mark.bubble.showNote(note);
  }
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

function markSending(root: ShadowRoot, items: readonly KeptPin[]): void {
  for (const { mark } of items) {
    mark.dot.setState('sending');
    mark.bubble.setPending();
  }
  if (items[0] !== undefined) root.append(items[0].mark.bubble.element);
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

/** Collector-chunk add-on: Send all hands every kept comment to the host as one batch and settles it with one outcome. */
export function sendAll(ctx: SendAllCtx): void {
  const { host, state } = ctx;
  const win = ctx.root.ownerDocument.defaultView ?? ({} as Window);
  const filed: Filed[] = [];
  const unpublish = publishFiled(win, filed);
  let batch: 'rest' | 'pending' | 'failed' = 'rest';
  let disposed = false;
  const retained = createKeeper();
  const open = (): boolean => host.getAttribute('data-pb-panel') === 'open';
  const ready = (): boolean =>
    open() &&
    batch !== 'pending' &&
    (state.flow === 'armed' ||
      state.flow === 'idle' ||
      (batch === 'failed' && state.flow === 'sending')) &&
    state.kept.items.length > 0;
  const succeed = (
    items: readonly KeptPin[],
    dest: Dest,
    outcome: Extract<BatchOutcome, { ok: true }>,
  ): void => {
    showSent(ctx.root, items, outcome);
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
    for (const { mark } of items) mark.dot.setState('failed');
    const first = items[0];
    if (first === undefined) return;
    ctx.root.append(first.mark.bubble.element);
    first.mark.bubble.showError(
      message,
      ctx.guard(() => start(dest)),
    );
    ctx.panel.refresh();
  };
  function start(dest: Dest): void {
    if (!ready()) return;
    const all = state.kept.items;
    const items = all.filter((item) => destOf(item) === dest);
    if (items.length === 0) return;
    if (batch !== 'failed') {
      if (state.flow === 'idle') dispatch(ctx, 'arm');
      ctx.leaveArmed();
      if (!dispatch(ctx, 'pin')) return;
    }
    dispatch(ctx, 'send');
    batch = 'pending';
    markSending(ctx.root, items);
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
  const asked = (event: Event): unknown => flush.take(event) || start(askedDest(event));
  // Deleting the last comment of a failed batch ends the send, as for a failed single send.
  const emptied = (): void => {
    if (batch !== 'failed' || state.flow !== 'sending' || state.kept.items.length > 0) return;
    batch = 'rest';
    retained.drop();
    state.flow = 'idle';
    enterPhase(state, host, 'idle');
    showLauncher(ctx.launcher, state.marks);
  };
  const listeners: [string, (event: Event) => void][] = [
    ['passback:send-all', ctx.guard(asked)],
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
