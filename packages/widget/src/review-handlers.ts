import type { Boundary } from './boundary';
import type { ReviewComment } from './review-session';
import { lastPage, type Handlers, type ReviewActions, type View } from './review-view';

const ACTION_FAILED = 'Could not complete review action.';
const HELD = 'Resolve these comments before sending back.';
const DRAFT = 'Send or clear your draft before sending back.';
const ENDED: Record<string, string> = {
  review_finished: 'Review finished.',
  review_expired: 'Review expired.',
};

type Refusal = { code?: string; comments?: string[] };
export type Live = { view: View; boundary: Boundary; closed(): boolean; render(): void };

/** What a refused action leaves on screen: the end of the review, the held comments, or a retry. */
export function refuse(view: View, refusal: Refusal | undefined): void {
  const ended = refusal?.code === undefined ? undefined : ENDED[refusal.code];
  if (ended) Object.assign(view, { over: true, notice: ended, held: [] });
  else if (refusal?.code === 'review_held') {
    Object.assign(view, { notice: HELD, held: refusal.comments ?? [] });
  } else view.notice = refusal?.code === 'draft_unsent' ? DRAFT : ACTION_FAILED;
}

/** Added detail as the agent reads it: the comment it belongs to, quoted, then the new text. */
export function withQuote(original: string, text: string): string {
  const quoted = original
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `${quoted}\n\n${text}`;
}

// An answer after close changes nothing; one that throws is the same as a transient failure.
function whenDone<R>(live: Live, work: () => Promise<R>, done: (result?: R) => void): void {
  const settled = live.boundary.guard((result?: R) => {
    if (live.closed()) return;
    done(result);
    live.render();
  });
  new Promise<R>((resolve) => resolve(work())).then(settled, () => settled());
}

function addOf(live: Live, actions: ReviewActions | undefined) {
  const { view } = live;
  return (comment: ReviewComment): void => {
    const text = (view.drafts.get(comment.id) ?? '').trim();
    const add = actions?.add;
    if (!add || text === '' || view.over || view.adding.has(comment.id)) return;
    view.adding.add(comment.id);
    Object.assign(view, { notice: '', held: [] });
    live.render();
    whenDone(
      live,
      () => add.call(actions, withQuote(comment.text, text)),
      (result) => {
        view.adding.delete(comment.id);
        if (!result?.ok) return refuse(view, result);
        view.added.set(comment.id, [...(view.added.get(comment.id) ?? []), text]);
        if ((view.drafts.get(comment.id) ?? '').trim() === text) view.drafts.delete(comment.id);
      },
    );
  };
}

/** The panel's controls: each action disables what it touches until its answer is in. */
export function handlersOf(live: Live, actions: ReviewActions | undefined): Handlers {
  const { view, boundary } = live;
  return {
    pick: boundary.guard((comment: ReviewComment, key: string) => {
      const from = comment.label;
      view.pending.add(comment.id);
      Object.assign(view, { notice: '', held: [] });
      live.render();
      whenDone(
        live,
        () => (actions as ReviewActions).overrule(comment.id, key),
        (result) => {
          view.pending.delete(comment.id);
          if (result?.ok) view.picked.set(comment.id, { key, from });
          else refuse(view, result);
        },
      );
    }),
    send: boundary.guard(() => {
      Object.assign(view, { sending: true, notice: '', held: [] });
      live.render();
      whenDone(
        live,
        () => (actions as ReviewActions).finish(),
        (result) => {
          view.sending = false;
          if (result?.ok) Object.assign(view, { over: true, summary: result.summary });
          else refuse(view, result);
        },
      );
    }),
    go: boundary.guard((page: number) => {
      const next = Math.max(0, Math.min(lastPage(view), page));
      if (view.over || next === view.page) return;
      view.page = next;
      live.render();
    }),
    draft: boundary.guard((comment: ReviewComment, text: string) => {
      view.drafts.set(comment.id, text);
    }),
    add: boundary.guard(addOf(live, actions)),
  };
}
