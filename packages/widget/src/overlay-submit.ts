import type { ResolveTarget } from '@passback/collectors';
import type { Offset } from '@passback/schema';
import type { Boundary } from './boundary';
import type { Bubble } from './bubble-view';
import type { Dot } from './dot-view';
import type { TrackedMark } from './overlay-reattach';
import { dispatch, type FlowCtx } from './overlay-draw';
import type { Phase } from './phase';

export type SubmitMark = { element: Element; offset: Offset; n: number; current: boolean };

export type SubmitDetail = {
  comment: string;
  selector: string;
  offset: Offset;
  element: Element;
  marks?: readonly SubmitMark[];
};

export type SubmitCtx = FlowCtx & {
  state: {
    phase: Phase;
    dot: Dot | null;
    bubble: Bubble | null;
    pinnedElement: Element | null;
    pinnedOffset: Offset | null;
    pendingDetail: SubmitDetail | null;
    pendingComment: string | null;
    submitting: boolean;
    marks: TrackedMark[];
    batchMarks?: readonly SubmitMark[];
    drawingDetail?: SubmitDetail | null;
  };
  host: HTMLElement;
  selectorOf(el: Element): string;
  targetOf?(el: Element): ResolveTarget;
  onSubmit(detail: SubmitDetail): void;
  ready?(): Promise<unknown>;
  fail(message: string): void;
  guard: Boundary['guard'];
  rows?: { changed(): void };
};

type Pinned = { bubble: Bubble; el: Element; offset: Offset; comment: string; own?: SubmitDetail };

export function resetSubmission(state: SubmitCtx['state']): void {
  Object.assign(state, { pendingDetail: null, pendingComment: null, submitting: false });
}

function pinnedOf({ state }: SubmitCtx, comment: string | null): Pinned | null {
  const { pinnedElement: el, pinnedOffset: offset, bubble, drawingDetail: own } = state;
  if (bubble === null) return null;
  if (!el) return own ? { ...own, bubble, el: own.element, own } : null;
  if (comment === null || offset === null) return null;
  return { bubble, el, offset, comment };
}

function detailOf(ctx: SubmitCtx, { bubble, el, offset, comment, own }: Pinned): SubmitDetail {
  const detail: SubmitDetail = own ?? {
    comment,
    selector: ctx.selectorOf(el),
    offset,
    element: el,
  };
  const { batchMarks } = ctx.state;
  if (batchMarks?.some((entry) => entry.current && entry.element === el)) detail.marks = batchMarks;
  const mark = ctx.state.marks.find((candidate) => candidate.bubble === bubble);
  if (mark !== undefined) {
    mark.offset = offset;
    if (ctx.targetOf !== undefined) mark.target = ctx.targetOf(el);
  }
  ctx.state.pendingDetail = detail;
  return detail;
}

function showSending(ctx: SubmitCtx, bubble: Bubble): void {
  dispatch(ctx, 'send');
  ctx.state.submitting = true;
  bubble.setPending();
  ctx.state.dot?.setState('sending');
  ctx.rows?.changed();
}

function awaitReady(ctx: SubmitCtx, ready: () => Promise<unknown>, pinned: Pinned): void {
  ctx.state.pendingDetail = null;
  ctx.state.pendingComment = pinned.comment;
  showSending(ctx, pinned.bubble);
  // A destroy, cancel or new composition replaces state.bubble, so a late outcome is dropped.
  const current = (): boolean => ctx.state.bubble === pinned.bubble;
  void ready().then(
    ctx.guard(() => {
      if (current()) ctx.onSubmit(detailOf(ctx, pinned));
    }),
    ctx.guard((err: unknown) => {
      if (current()) ctx.fail(err instanceof Error ? err.message : String(err));
    }),
  );
}

export function submitComment(ctx: SubmitCtx, comment: string): void {
  const pinned = pinnedOf(ctx, comment);
  if (pinned === null) return;
  const mark = ctx.state.marks.find((candidate) => candidate.bubble === pinned.bubble);
  Object.assign(mark ?? {}, { comment, element: pinned.el });
  if (ctx.ready !== undefined) return awaitReady(ctx, ctx.ready, pinned);
  const detail = detailOf(ctx, pinned);
  showSending(ctx, pinned.bubble);
  ctx.onSubmit(detail);
}

function drawingEligible(ctx: SubmitCtx, drawings: number): boolean {
  const { state } = ctx;
  return (
    state.flow === 'armed' &&
    state.phase === 'armed' &&
    !state.submitting &&
    drawings > 0 &&
    state.pinnedElement === null &&
    state.bubble === null &&
    state.kept.items.length === 0 &&
    state.marks.length === 0
  );
}

// connects this to the drawing count; `drawings` is the completed shapes now on the page.
export function submitDrawing(
  ctx: SubmitCtx,
  detail: SubmitDetail,
  bubble: Bubble,
  drawings: number,
): boolean {
  const body = ctx.host.ownerDocument.body;
  const valid =
    detail.element === body &&
    detail.selector === 'body' &&
    detail.offset.x === 0 &&
    detail.offset.y === 0 &&
    detail.comment.trim() !== '' &&
    Array.isArray(detail.marks) &&
    detail.marks.length === 0;
  if (!valid || !drawingEligible(ctx, drawings)) return false;
  const { state } = ctx;
  state.bubble = bubble;
  state.drawingDetail = detail;
  const pinned = pinnedOf(ctx, detail.comment)!;
  if (ctx.ready !== undefined) awaitReady(ctx, ctx.ready, pinned);
  else {
    showSending(ctx, bubble);
    ctx.onSubmit(detailOf(ctx, pinned));
  }
  return true;
}

export function retrySubmit(ctx: SubmitCtx): void {
  const { state } = ctx;
  if (state.bubble === null || state.submitting) return;
  if (state.pendingDetail === null) {
    const pinned = pinnedOf(ctx, state.pendingComment);
    if (pinned !== null && ctx.ready !== undefined) awaitReady(ctx, ctx.ready, pinned);
    return;
  }
  showSending(ctx, state.bubble);
  ctx.onSubmit(state.pendingDetail);
}
