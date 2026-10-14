import type { Boundary } from './boundary';
import { keptFull } from './kept';
import { phaseOf, transition, type FlowEffect, type FlowEvent, type FlowState } from './overlay-flow';
import { KEPT_FULL_NOTE, keepCurrent, type KeepCtx } from './overlay-marks';
import { enterPhase } from './phase';

export type Drawing = { toggle(on: boolean): void; cancel(): void };
type Flow = { flow: FlowState };
export type FlowCtx = KeepCtx & { host: HTMLElement; drawing?: Drawing; state: Flow;
  panel?: { syncDraw(): void };
};

const draftText = ({ state }: FlowCtx): string =>
  state.bubble?.element.querySelector('textarea')?.value.trim() ?? '';

function settle(ctx: FlowCtx): void {
  if (draftText(ctx) !== '') keepCurrent(ctx, draftText(ctx));
  ctx.state.dot?.remove();
  ctx.state.bubble?.destroy();
  ctx.state.marks = ctx.state.marks.filter((mark) => mark.dot !== ctx.state.dot);
  Object.assign(ctx.state, { dot: null, bubble: null });
}

function drop(ctx: FlowCtx): void {
  const { state } = ctx;
  state.dot?.remove();
  state.bubble?.destroy();
  state.marks = state.marks.filter((mark) => mark.dot !== state.dot);
  Object.assign(state, { dot: null, bubble: null, pinnedElement: null, pinnedOffset: null });
}

function apply(ctx: FlowCtx, effect: FlowEffect, notify: boolean): void {
  if (effect === 'abandon') ctx.drawing?.cancel();
  else if (effect === 'settle') settle(ctx);
  else if (effect === 'drop') drop(ctx);
  else {
    if (!notify) ctx.drawing?.toggle(effect === 'on');
    ctx.state.bubble?.setDrawing(effect === 'on');
  }
}

// Runs the table's effects for one event; `notify` reports a drawing change already made.
export function dispatch(ctx: FlowCtx, event: FlowEvent, notify = false): boolean {
  const step = transition(ctx.state.flow, event);
  for (const effect of step.effects) apply(ctx, effect, notify);
  if (!step.ok) return false;
  ctx.state.flow = step.state;
  enterPhase(ctx.state, ctx.host, phaseOf(step.state));
  ctx.panel?.syncDraw();
  return true;
}

// The one entry for launcher, hotkey, Overlay.arm() and the keep button; true once armed.
export function requestArm(ctx: FlowCtx): boolean {
  if (ctx.state.flow === 'idle') return dispatch(ctx, 'arm');
  if (!transition(ctx.state.flow, 'addMark').ok) return false;
  if (draftText(ctx) === '' || !keptFull(ctx.state.kept)) return dispatch(ctx, 'addMark');
  dispatch(ctx, 'drawOff');
  ctx.state.bubble?.showNote(KEPT_FULL_NOTE);
  return false;
}

export function drawOption(
  ctx: FlowCtx,
  guard: Boundary['guard'],
): { onDraw?: (on: boolean) => void } {
  if (ctx.drawing === undefined) return {};
  return { onDraw: guard((on: boolean) => void dispatch(ctx, on ? 'drawOn' : 'drawOff')) };
}
