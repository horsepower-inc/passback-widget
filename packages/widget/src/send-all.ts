import { keptReducer } from './kept';
import type { Launcher } from './launcher';
import { dispatch } from './overlay-draw';
import type { KeptPin } from './overlay-marks';
import { submitComment, type SubmitCtx } from './overlay-submit';

export type SendAllCtx = SubmitCtx & {
  root: ShadowRoot;
  leaveArmed(): void;
  launcher: Launcher;
  panel: { refresh(): void };
};

function show(ctx: SendAllCtx, item: KeptPin): void {
  const { mark } = item;
  Object.assign(ctx.state, {
    dot: mark.dot,
    bubble: mark.bubble,
    pinnedElement: item.element,
    pinnedOffset: item.offset,
  });
  ctx.root.append(mark.bubble.element);
  submitComment(ctx, item.comment);
}

/** Collector-chunk add-on: Send all sends the kept comments one at a time through the single-send path. */
export function sendAll(ctx: SendAllCtx): void {
  const { host, state } = ctx;
  let current: KeptPin | null = null;
  const open = (): boolean => host.getAttribute('data-pb-panel') === 'open';
  const ready = (): boolean =>
    open() &&
    current === null &&
    (state.flow === 'armed' || state.flow === 'idle') &&
    state.kept.items.length > 0;
  const start = (): void => {
    const item = state.kept.items[0];
    if (!ready() || item === undefined) return;
    if (state.flow === 'idle') dispatch(ctx, 'arm');
    ctx.leaveArmed();
    if (!dispatch(ctx, 'pin')) return;
    current = item;
    show(ctx, item);
  };
  const acknowledged = (): void => {
    const item = current;
    if (item === null || state.flow !== 'idle') return;
    const n = state.kept.items.indexOf(item) + 1;
    if (n > 0 && item.mark.id === undefined) return;
    current = null;
    if (n === 0) return;
    state.kept = keptReducer(state.kept, { type: 'remove', n });
    for (const [i, { mark }] of state.kept.items.entries())
      mark.dot.element.textContent = mark.dot.element.dataset.n = String(i + 1);
    ctx.launcher.update(state.marks);
    ctx.panel.refresh();
    if (open() && state.kept.items.length > 0) queueMicrotask(ctx.guard(start));
  };
  const listeners: [string, () => void][] = [
    ['passback:send-all', ctx.guard(start)],
    ['passback:sync', ctx.guard(acknowledged)],
    [
      'passback:dispose',
      () => (
        listeners.forEach(([type, fn]) => host.removeEventListener(type, fn)),
        (current = null)
      ),
    ],
  ];
  listeners.forEach(([type, fn]) => host.addEventListener(type, fn));
}
