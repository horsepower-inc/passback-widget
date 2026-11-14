import type { ResolveTarget } from '@passback/collectors';
import type { ChannelStatus, Offset } from '@passback/schema';
import type { Boundary } from './boundary';
import type { Bubble } from './bubble-view';
import { createBubble } from './bubble-view';
import type { Dot, Outline } from './dot-view';
import { createDot, createOutline, setCrosshair } from './dot-view';
import type { Launcher } from './launcher';
import { createLauncher, listenForHotkey, showLauncher } from './launcher';
import { attachAddons } from './fx';
import type { Settings } from './config';
import { readSettings } from './config';
import type { PinEvent, PinState } from './pin';
import { IDLE, pinReducer } from './pin';
import { listenForPin } from './pin-listeners';
import { dispatch, drawOption, requestArm, type Drawing } from './overlay-draw';
import type { FlowState } from './overlay-flow';
import type { Kept } from './kept';
import { emptyKept } from './kept';
import type { KeptPin } from './overlay-marks';
import { keepHandler, noteWhenFull, sendAllHandler } from './overlay-marks';
import { createMarkRows, type MarkRows } from './overlay-mark-rows';
import type { OpenOverlayMark, TrackedMark } from './overlay-reattach';
import { openMarksOf } from './overlay-reattach';
import type { SubmitDetail } from './overlay-submit';
import { handleAcked, resetSubmission, retrySubmit, submitComment } from './overlay-submit';
import type { Panel } from './overlay-panel';
import { createPanel } from './overlay-panel';
import type { RestoreEntry } from './inbox-restore';
import { reconcileRestored } from './overlay-restore';
import type { Phase } from './phase';
import type { Reattached } from './reattach';
import type { ViewRestore } from './view-state';
import type { ReopenPort } from './reopen';

declare const __PB_LOCAL__: boolean;

export type { SubmitDetail } from './overlay-submit';

export type OverlayOptions = {
  doc: Document;
  root: ShadowRoot;
  host: HTMLElement;
  selectorOf(el: Element): string;
  targetOf?(el: Element): ResolveTarget;
  onSubmit(detail: SubmitDetail): void;
  ready?(): Promise<unknown>;
  onArm?(): void;
  drawing?: Drawing;
  guard?: Boundary['guard'];
  reopen?: ReopenPort;
};

export type Overlay = {
  arm(): void;
  phase(): Phase;
  acked(id: string, trimmed: boolean, note?: string, opts?: { relay?: boolean }): void;
  setDrawing(on: boolean): void;
  failed(message: string): void;
  status(event: Pick<ChannelStatus, 'markId' | 'state' | 'message' | 'prUrl'>): void;
  openMarks(): OpenOverlayMark[];
  reattach(results: readonly Reattached<OpenOverlayMark>[], view: ViewRestore): void;
  restore(entries: readonly RestoreEntry[]): void;
  renumber(): void;
  destroy(): void;
};

type State = {
  phase: Phase;
  flow: FlowState;
  pinState: PinState;
  stopPin: (() => void) | null;
  outline: Outline | null;
  dot: Dot | null;
  bubble: Bubble | null;
  pinnedElement: Element | null;
  pinnedOffset: Offset | null;
  pendingDetail: SubmitDetail | null;
  pendingComment: string | null;
  submitting: boolean;
  marks: TrackedMark[];
  kept: Kept<KeptPin>;
};

type Ctx = {
  doc: Document;
  root: ShadowRoot;
  host: HTMLElement;
  selectorOf(el: Element): string;
  targetOf?(el: Element): ResolveTarget;
  onSubmit(detail: SubmitDetail): void;
  ready?(): Promise<unknown>;
  fail(message: string): void;
  onArm?(): void;
  drawing?: Drawing;
  guard: Boundary['guard'];
  reopen?: ReopenPort;
  leaveArmed(): void;
  launcher: Launcher;
  panel: Panel;
  rows: MarkRows;
  state: State;
};

function initialState(): State {
  return {
    phase: 'idle',
    flow: 'hidden',
    pinState: IDLE,
    stopPin: null,
    outline: null,
    dot: null,
    bubble: null,
    pinnedElement: null,
    pinnedOffset: null,
    pendingDetail: null,
    pendingComment: null,
    submitting: false,
    marks: [],
    kept: emptyKept(),
  };
}

function leaveArmed(ctx: Ctx): void {
  const { state } = ctx;
  state.stopPin?.();
  state.stopPin = null;
  state.outline?.destroy();
  state.outline = null;
  setCrosshair(ctx.doc, false);
  // A settled empty pin leaves its element behind; with no dot or bubble nothing owns it.
  if (!state.dot && !state.bubble) resetSubmission(state);
}

function goArmed(ctx: Ctx): void {
  const { state } = ctx;
  if (ctx.panel.resume() || !requestArm(ctx)) return;
  leaveArmed(ctx);
  ctx.panel.reveal();
  ctx.onArm?.();
  setCrosshair(ctx.doc, true);
  state.outline = createOutline(ctx.root);
  state.pinState = pinReducer(IDLE, { type: 'arm' });
  state.stopPin = listenForPin({
    doc: ctx.doc,
    host: ctx.host,
    dispatch: ctx.guard((event: PinEvent) => onPinEvent(ctx, event)),
  });
}

function goIdle(ctx: Ctx): void {
  leaveArmed(ctx);
  showLauncher(ctx.launcher, ctx.state.marks);
}

function goComposing(ctx: Ctx, element: Element, offset: Offset): void {
  if (!dispatch(ctx, 'pin')) return;
  leaveArmed(ctx);
  const { state } = ctx;
  const rect = element.getBoundingClientRect();
  const point = { x: rect.left + offset.x, y: rect.top + offset.y };
  resetSubmission(state);
  const dot = createDot(ctx.root, point, ctx.rows.nextNumber());
  const bubble = createBubble(ctx.root, {
    anchor: point,
    ...drawOption(ctx, ctx.guard),
    onSend: ctx.guard((comment: string) => submitComment(ctx, comment)),
    onCancel: ctx.guard(() => ctx.panel.dismiss()),
    onKeep: keepHandler(ctx, () => goArmed(ctx)),
    kept: state.kept.items.length,
    onSendAll: sendAllHandler(ctx, () => goArmed(ctx)),
    onDiscard: ctx.guard(() => {
      if (dispatch(ctx, 'discard')) goArmed(ctx);
    }),
  });
  noteWhenFull(state.kept, bubble);
  Object.assign(state, { dot, bubble, pinnedElement: element, pinnedOffset: offset });
  bubble.setDrawing(state.flow === 'drawing');
  state.marks.push({ dot, bubble, lastState: 'pinned' });
}

function onPinEvent(ctx: Ctx, event: PinEvent): void {
  const { state } = ctx;
  // Escape belongs to the panel's IME-aware dismissal listener.
  if (event.type === 'cancel') return;
  state.pinState = pinReducer(state.pinState, event);
  if (event.type === 'hover') {
    state.outline?.show(state.pinState.phase === 'armed' ? state.pinState.hovered : null);
    ctx.host.dispatchEvent(
      new CustomEvent('passback:hover', {
        detail: state.pinState.phase === 'armed' ? state.pinState.hovered : null,
      }),
    );
    return;
  }
  if (event.type === 'pin' && state.pinState.phase === 'pinned') {
    goComposing(ctx, state.pinState.element, state.pinState.offset);
  }
}

function handleFailed(ctx: Ctx, message: string): void {
  if (!dispatch(ctx, 'failed')) return;
  ctx.state.submitting = false;
  ctx.state.dot?.setState('failed');
  ctx.state.bubble?.showError(
    message,
    ctx.guard(() => retrySubmit(ctx)),
  );
  ctx.rows.changed();
}

function destroyOverlay(ctx: Ctx, stopHotkey: () => void): void {
  if (!dispatch(ctx, 'hide')) return;
  stopHotkey();
  leaveArmed(ctx);
  ctx.panel.dispose();
  ctx.launcher.destroy();
  ctx.state.marks.forEach((mark) => {
    mark.dot.remove();
    mark.bubble.destroy();
  });
  ctx.state.marks = [];
  resetSubmission(ctx.state);
}

function buildCtx(opts: OverlayOptions, guard: Boundary['guard'], settings: Settings): Ctx {
  const partial: Omit<Ctx, 'launcher' | 'panel' | 'rows' | 'fail' | 'leaveArmed'> = {
    doc: opts.doc,
    root: opts.root,
    host: opts.host,
    selectorOf: opts.selectorOf,
    targetOf: opts.targetOf,
    onSubmit: opts.onSubmit,
    ready: opts.ready,
    onArm: opts.onArm,
    drawing: opts.drawing,
    reopen: opts.reopen,
    guard,
    state: initialState(),
  };
  const ctx = partial as Ctx;
  ctx.fail = (message) => handleFailed(ctx, message);
  ctx.leaveArmed = () => leaveArmed(ctx);
  ctx.launcher = createLauncher(
    opts.root,
    guard(() => ctx.panel.press()),
    settings,
  );
  ctx.rows = createMarkRows(ctx);
  ctx.panel = createPanel(ctx, { arm: () => goArmed(ctx), idle: () => goIdle(ctx) });
  return ctx;
}

export function createOverlay(opts: OverlayOptions): Overlay {
  const guard = opts.guard ?? ((fn) => fn);
  const settings = readSettings(opts.doc);
  const ctx = buildCtx(opts, guard, settings);
  dispatch(ctx, 'show');
  const stopAddons = attachAddons(ctx);
  let gone = false;
  const stopHotkey = listenForHotkey(
    opts.doc,
    guard(() => ctx.panel.press()),
    settings.hotkey,
  );

  return {
    arm: () => goArmed(ctx),
    phase: () => ctx.state.phase,
    acked: (...args) => handleAcked(ctx, ...args),
    setDrawing: (on) => void dispatch(ctx, on ? 'drawOn' : 'drawOff', true),
    failed: (message) => handleFailed(ctx, message),
    status: (event) => ctx.rows.status(event),
    openMarks: () => openMarksOf(ctx.state.marks),
    reattach: (results, view) => ctx.rows.reattach(results, view),
    restore: (entries) => {
      if (typeof __PB_LOCAL__ === 'undefined' || __PB_LOCAL__) reconcileRestored(ctx, entries);
    },
    renumber: () => void (gone || ctx.rows.renumber()),
    destroy: () => ((gone = true), destroyOverlay(ctx, () => (stopHotkey(), stopAddons()))),
  };
}
