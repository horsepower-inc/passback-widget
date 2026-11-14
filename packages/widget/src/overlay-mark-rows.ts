import { answerOf } from './answer';
import { keptOffset } from './inbox-numbers';
import { destOf, keptReducer, type Dest } from './kept';
import { showLauncher, type Launcher } from './launcher';
import { applyStatus } from './overlay-marks';
import { applyReattach, type TrackedMark } from './overlay-reattach';
import { resetSubmission, type SubmitCtx } from './overlay-submit';
import { enterPhase } from './phase';
import type { ReopenPort } from './reopen';
import type { MarkRow, RowAction } from './tray-view';
import type { ViewRestore } from './view-state';

declare const __PB_LOCAL__: boolean;

type Ctx = SubmitCtx & {
  root: ShadowRoot;
  launcher: Launcher;
  panel: { refresh(): void };
  reopen?: ReopenPort;
};
export type MarkRows = ReturnType<typeof createMarkRows>;

const keptAt = ({ state }: Ctx, m: TrackedMark) => state.kept.items.findIndex((i) => i.mark === m);
const winOf = ({ root }: Ctx): Window =>
  root.ownerDocument.defaultView ?? ({} as unknown as Window);
const offsetOf = (ctx: Ctx): number => keptOffset(winOf(ctx));
const locked = ({ state }: Ctx, m: TrackedMark) => state.submitting && state.bubble === m.bubble;

function changed(ctx: Ctx): void {
  ctx.panel.refresh();
}

function numberPins(ctx: Ctx): void {
  const offset = offsetOf(ctx);
  for (const [i, { mark }] of ctx.state.kept.items.entries()) {
    mark.dot.setNumber(offset + i + 1);
    mark.dot.element.dataset.n = String(offset + i + 1);
  }
}

function remove(ctx: Ctx, mark: TrackedMark): void {
  const { state } = ctx;
  if (locked(ctx, mark) || !state.marks.includes(mark)) return;
  state.kept = keptReducer(state.kept, { type: 'remove', n: keptAt(ctx, mark) + 1 });
  state.marks = state.marks.filter((candidate) => candidate !== mark);
  mark.dot.remove();
  mark.bubble.destroy();
  numberPins(ctx);
  // Deleting a failed submission ends the send, as a cancel would.
  if (state.bubble === mark.bubble && state.flow === 'sending') {
    Object.assign(state, { dot: null, bubble: null, flow: 'idle' });
    enterPhase(state, ctx.host, 'idle');
    resetSubmission(state);
    showLauncher(ctx.launcher, state.marks);
  } else ctx.launcher.update(state.marks);
  changed(ctx);
}

function setDest(ctx: Ctx, mark: TrackedMark, dest: Dest): void {
  const { state } = ctx;
  const i = keptAt(ctx, mark);
  if (i < 0 || locked(ctx, mark)) return;
  const next = keptReducer(state.kept, { type: 'dest', n: i + 1, dest });
  if (next === state.kept) return;
  state.kept = next;
  changed(ctx);
}

function act(ctx: Ctx, mark: TrackedMark, action: RowAction): void {
  if (action === 'delete') remove(ctx, mark);
  else setDest(ctx, mark, action === 'to-tracker' ? 'tracker' : 'agent');
}

function row(ctx: Ctx, m: TrackedMark): MarkRow {
  const i = keptAt(ctx, m);
  return {
    n: i >= 0 ? offsetOf(ctx) + i + 1 : undefined,
    comment: ctx.state.kept.items[i]?.comment ?? m.comment ?? '',
    locked: locked(ctx, m),
    dest: i >= 0 ? destOf(ctx.state.kept.items[i]!) : undefined,
    act: ctx.guard((action: RowAction) => act(ctx, m, action)),
  };
}

export function createMarkRows(ctx: Ctx) {
  return {
    rows: () => ctx.state.kept.items.map(({ mark }) => row(ctx, mark)),
    discardAll: () => ctx.state.kept.items.map((i) => i.mark).forEach((m) => remove(ctx, m)),
    changed: () => changed(ctx),
    nextNumber: () => offsetOf(ctx) + ctx.state.kept.items.length + 1,
    renumber() {
      numberPins(ctx);
      changed(ctx);
    },
    status(event: Parameters<typeof applyStatus>[1]) {
      const answer =
        typeof __PB_LOCAL__ === 'undefined' || __PB_LOCAL__
          ? answerOf(winOf(ctx) as Window & typeof globalThis)
          : undefined;
      applyStatus(ctx.state.marks, event, ctx.reopen, answer);
      ctx.launcher.update(ctx.state.marks);
      changed(ctx);
    },
    reattach(results: Parameters<typeof applyReattach>[1], restore: ViewRestore) {
      if (typeof __PB_LOCAL__ === 'undefined' || __PB_LOCAL__)
        applyReattach(ctx.state.marks, results, restore);
      changed(ctx);
    },
  };
}
