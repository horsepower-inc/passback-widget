import type { ResolveTarget } from '@passback/collectors';
import type { ChannelStatus, Offset } from '@passback/schema';
import type { Boundary } from './boundary';
import type { Bubble } from './bubble-view';
import type { Launcher } from './launcher';
import { fxOf } from './fx';
import type { Dot } from './dot-view';
import type { Kept, KeptComment } from './kept';
import { keptFull, keptReducer } from './kept';
import { offerReopen } from './overlay-reopen';
import type { TrackedMark } from './overlay-reattach';
import type { ReopenPort } from './reopen';

declare const __PB_LOCAL__: boolean;

export const KEPT_FULL_NOTE = '20 comments is the limit. Send them before you add more.';

export type KeptPin = KeptComment & { mark: TrackedMark };

export type KeepCtx = {
  selectorOf(el: Element): string;
  targetOf?(el: Element): ResolveTarget;
  guard: Boundary['guard'];
  root?: ShadowRoot;
  launcher?: Launcher;
  state: {
    phase: 'idle' | 'armed' | 'composing' | 'sending';
    kept: Kept<KeptPin>;
    marks: TrackedMark[];
    dot: Dot | null;
    bubble: Bubble | null;
    pinnedElement: Element | null;
    pinnedOffset: Offset | null;
  };
};

export function keepCurrent(ctx: KeepCtx, comment: string): boolean {
  const { state } = ctx;
  const { pinnedElement: element, pinnedOffset: offset } = state;
  if (state.phase !== 'composing' || element === null || offset === null) return false;
  const mark = state.marks.find((candidate) => candidate.bubble === state.bubble);
  if (mark === undefined) return false;
  const item = { element, selector: ctx.selectorOf(element), offset, comment, mark };
  const next = keptReducer(state.kept, { type: 'add', item });
  if (next === state.kept) return false;
  mark.offset = offset;
  if (ctx.targetOf) mark.target = ctx.targetOf(element);
  const text = String(next.items.length);
  mark.dot.element.textContent = text;
  mark.dot.element.setAttribute('data-n', text);
  mark.bubble.element.remove();
  state.kept = next;
  state.dot = null;
  state.bubble = null;
  state.pinnedElement = null;
  state.pinnedOffset = null;
  state.phase = 'idle';
  return true;
}

export function keepHandler(
  ctx: KeepCtx,
  rearm: () => void,
): ((comment: string) => void) | undefined {
  if (keptFull(ctx.state.kept)) return undefined;
  return ctx.guard((comment: string) => {
    const { pinnedElement: element, pinnedOffset: offset } = ctx.state;
    const rect = element?.getBoundingClientRect();
    if (!keepCurrent(ctx, comment)) return;
    if (ctx.root && ctx.launcher && rect && offset) {
      fxOf(ctx.root).fly?.({
        root: ctx.root,
        from: { x: rect.left + offset.x, y: rect.top + offset.y },
        to: ctx.launcher.element,
        text: comment,
      });
    }
    ctx.launcher?.update(ctx.state.marks);
    rearm();
  });
}

export function sendAllHandler(
  ctx: KeepCtx & { host: HTMLElement },
  rearm: () => void,
): ((comment: string) => void) | undefined {
  if (keptFull(ctx.state.kept)) return undefined;
  return ctx.guard((comment: string) => {
    const before = ctx.state.kept;
    keepHandler(ctx, rearm)?.(comment);
    if (ctx.state.kept !== before) ctx.host.dispatchEvent(new Event('passback:send-all'));
  });
}

export function noteWhenFull(kept: Kept<KeptPin>, bubble: Bubble): void {
  if (keptFull(kept)) bubble.showNote(KEPT_FULL_NOTE);
}

export function applyStatus(
  marks: readonly TrackedMark[],
  event: Pick<ChannelStatus, 'markId' | 'state' | 'message' | 'prUrl'>,
  reopen?: ReopenPort,
): boolean {
  const mark = marks.find((candidate) => candidate.id === event.markId);
  if (mark === undefined) return false;
  mark.lastState = event.state;
  mark.dot.setState(event.state);
  mark.bubble.showStatus(event);
  if (
    (typeof __PB_LOCAL__ === 'undefined' || __PB_LOCAL__) &&
    reopen !== undefined &&
    event.state === 'done'
  )
    offerReopen(mark, event, reopen);
  return true;
}
