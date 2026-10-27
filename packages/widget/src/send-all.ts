import { keptReducer } from './kept';
import { showLauncher, type Launcher } from './launcher';
import { dispatch } from './overlay-draw';
import type { KeptPin } from './overlay-marks';
import type { SubmitCtx, SubmitDetail, SubmitMark } from './overlay-submit';
import { enterPhase } from './phase';
import type { BatchOutcome, SubmitAllDetail } from './send-batch';

export type SendAllCtx = SubmitCtx & {
  root: ShadowRoot;
  leaveArmed(): void;
  launcher: Launcher;
  panel: { refresh(): void };
};

function detailsOf(items: readonly KeptPin[]): SubmitDetail[] {
  return items.map((item, index) => ({
    comment: item.comment,
    selector: item.selector,
    offset: item.offset,
    element: item.element,
    marks: items.map((entry, i): SubmitMark => ({
      element: entry.element,
      offset: entry.offset,
      n: i + 1,
      current: i === index,
    })),
  }));
}

/** Collector-chunk add-on: Send all hands every kept comment to the host as one batch and settles it with one outcome. */
export function sendAll(ctx: SendAllCtx): void {
  const { host, state } = ctx;
  let batch: 'rest' | 'pending' | 'failed' = 'rest';
  let disposed = false;
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
    outcome: Extract<BatchOutcome, { ok: true }>,
  ): void => {
    const next = outcome.relay ? 'sent' : 'queued';
    for (const [i, { mark }] of items.entries()) {
      const id = outcome.ids[i]!;
      mark.id = id;
      mark.lastState = next;
      mark.dot.setState(next);
      ctx.root.append(mark.bubble.element);
      if (outcome.relay) mark.bubble.showSent();
      else mark.bubble.showAcked(id, outcome.trimmed[i] ?? false);
      const note = outcome.notes[i];
      if (note !== undefined) mark.bubble.showNote(note);
    }
    batch = 'rest';
    dispatch(ctx, 'acked');
    state.kept = keptReducer(state.kept, { type: 'clear' });
    ctx.launcher.update(state.marks);
    ctx.panel.refresh();
  };
  const fail = (items: readonly KeptPin[], message: string): void => {
    batch = 'failed';
    for (const { mark } of items) mark.dot.setState('failed');
    const first = items[0];
    if (first === undefined) return;
    ctx.root.append(first.mark.bubble.element);
    first.mark.bubble.showError(message, ctx.guard(start));
    ctx.panel.refresh();
  };
  function start(): void {
    if (!ready()) return;
    const items = state.kept.items;
    if (batch !== 'failed') {
      if (state.flow === 'idle') dispatch(ctx, 'arm');
      ctx.leaveArmed();
      if (!dispatch(ctx, 'pin')) return;
    }
    dispatch(ctx, 'send');
    batch = 'pending';
    for (const { mark } of items) {
      mark.dot.setState('sending');
      mark.bubble.setPending();
    }
    if (items[0] !== undefined) ctx.root.append(items[0].mark.bubble.element);
    ctx.panel.refresh();
    let settled = false;
    const settle = ctx.guard((outcome: BatchOutcome): void => {
      if (settled || disposed) return;
      settled = true;
      if (outcome.ok) succeed(items, outcome);
      else fail(items, outcome.message);
    });
    const detail: SubmitAllDetail = { details: detailsOf(items), settle };
    host.dispatchEvent(new CustomEvent('passback:submit-all', { detail, bubbles: false }));
  }
  // Deleting the last comment of a failed batch ends the send, as for a failed single send.
  const emptied = (): void => {
    if (batch !== 'failed' || state.flow !== 'sending' || state.kept.items.length > 0) return;
    batch = 'rest';
    state.flow = 'idle';
    enterPhase(state, host, 'idle');
    showLauncher(ctx.launcher, state.marks);
  };
  const listeners: [string, () => void][] = [
    ['passback:send-all', ctx.guard(start)],
    ['passback:sync', ctx.guard(emptied)],
    [
      'passback:dispose',
      () => (
        listeners.forEach(([type, fn]) => host.removeEventListener(type, fn)),
        (disposed = true)
      ),
    ],
  ];
  listeners.forEach(([type, fn]) => host.addEventListener(type, fn));
}
