import type { ResolveTarget } from '@passback/collectors';
import type { Offset } from '@passback/schema';
import type { Boundary } from './boundary';
import type { Bubble } from './bubble-view';
import type { Dot } from './dot-view';
import type { TrackedMark } from './overlay-reattach';
import { dispatch, type FlowCtx } from './overlay-draw';
import type { Phase } from './phase';

export type SubmitDetail = { comment: string; selector: string; offset: Offset; element: Element };

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

type Pinned = { bubble: Bubble; el: Element; offset: Offset; comment: string };

export function resetSubmission(state: SubmitCtx['state']): void {
  Object.assign(state, { pendingDetail: null, pendingComment: null, submitting: false });
}

function pinnedOf({ state }: SubmitCtx, comment: string | null): Pinned | null {
  const { pinnedElement: el, pinnedOffset: offset, bubble } = state;
  if (el === null || offset === null || bubble === null || comment === null) return null;
  return { bubble, el, offset, comment };
}

function detailOf(ctx: SubmitCtx, { bubble, el, offset, comment }: Pinned): SubmitDetail {
  const detail: SubmitDetail = { comment, selector: ctx.selectorOf(el), offset, element: el };
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
