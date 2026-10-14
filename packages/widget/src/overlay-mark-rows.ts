import { keptReducer } from './kept';
import { showLauncher, type Launcher } from './launcher';
import { applyStatus } from './overlay-marks';
import { applyReattach, type TrackedMark } from './overlay-reattach';
import { resetSubmission, type SubmitCtx } from './overlay-submit';
import { enterPhase } from './phase';
import type { ReopenPort } from './reopen';
import type { MarkRow, RowAction } from './tray-view';
import type { ViewRestore } from './view-state';

type Ctx = SubmitCtx & {
  root: ShadowRoot;
  launcher: Launcher;
  panel: { refresh(): void };
  reopen?: ReopenPort;
};
export type MarkRows = ReturnType<typeof createMarkRows>;

const keptAt = ({ state }: Ctx, m: TrackedMark) => state.kept.items.findIndex((i) => i.mark === m);
const locked = ({ state }: Ctx, m: TrackedMark) => state.submitting && state.bubble === m.bubble;

function changed(ctx: Ctx): void {
  ctx.panel.refresh();
}

function remove(ctx: Ctx, mark: TrackedMark): void {
  const { state } = ctx;
  if (locked(ctx, mark) || !state.marks.includes(mark)) return;
  state.kept = keptReducer(state.kept, { type: 'remove', n: keptAt(ctx, mark) + 1 });
  state.marks = state.marks.filter((candidate) => candidate !== mark);
  mark.dot.remove();
  mark.bubble.destroy();
  for (const [i, { mark: kept }] of state.kept.items.entries())
    kept.dot.element.textContent = kept.dot.element.dataset.n = String(i + 1);
  // Deleting a failed submission ends the send, as a cancel would.
  if (state.bubble === mark.bubble && state.flow === 'sending') {
    Object.assign(state, { dot: null, bubble: null, flow: 'idle' });
    enterPhase(state, ctx.host, 'idle');
    resetSubmission(state);
    showLauncher(ctx.launcher, state.marks);
  } else ctx.launcher.update(state.marks);
  changed(ctx);
}

function act(ctx: Ctx, mark: TrackedMark, action: RowAction): void {
  if (action === 'delete') remove(ctx, mark);
}

function row(ctx: Ctx, m: TrackedMark): MarkRow {
  const i = keptAt(ctx, m);
  return {
    n: i >= 0 ? i + 1 : undefined,
    comment: ctx.state.kept.items[i]?.comment ?? m.comment ?? '',
    locked: locked(ctx, m),
    act: ctx.guard((action: RowAction) => act(ctx, m, action)),
  };
}

export function createMarkRows(ctx: Ctx) {
  return {
    rows: () => ctx.state.kept.items.map(({ mark }) => row(ctx, mark)),
    discardAll: () => ctx.state.kept.items.map((i) => i.mark).forEach((m) => remove(ctx, m)),
    changed: () => changed(ctx),
    status(event: Parameters<typeof applyStatus>[1]) {
      applyStatus(ctx.state.marks, event, ctx.reopen);
      ctx.launcher.update(ctx.state.marks);
      changed(ctx);
    },
    reattach(results: Parameters<typeof applyReattach>[1], restore: ViewRestore) {
      applyReattach(ctx.state.marks, results, restore);
      changed(ctx);
    },
  };
}
