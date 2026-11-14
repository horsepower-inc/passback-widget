import { createBoundary, type Boundary } from './boundary';
import { REVIEW_RULES } from './review-panel-styles';
import { routeOf, type ReviewRoute } from './review-route';
import { lastPage } from './review-view';
import {
  cardNodes,
  type AddResult,
  type Handlers,
  type ReviewActions,
  type View,
} from './review-card';
import { handlersOf, refuse, type Live } from './review-handlers';
import {
  createReviewSession,
  type ReviewComment,
  type ReviewSession,
  type ReviewUpdate,
} from './review-session';

// The review session panel and its activation, built as their own chunk (dist/passback-review-panel.js).
export type { ReviewComment, ReviewSession };

export type ReviewPanelOptions = {
  root: ShadowRoot;
  session: ReviewSession;
  actions?: ReviewActions;
};
export type ReviewPanel = {
  element: HTMLElement;
  update(session: ReviewSession): void;
  end(code: string): void;
  close(): void;
};
export type ReviewPanelOpen = (opts: ReviewPanelOptions) => ReviewPanel | undefined;

const STYLE = 'data-pb-review-style';
const PAGE_KEYS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

const printOf = (session: ReviewSession): string =>
  JSON.stringify({ ...session, cursor: '', expiresAt: '' });

// A rebuild keeps the keyboard where it was, and returns it to a control that was disabled for a moment.
function renderer(root: ShadowRoot, card: HTMLElement, view: View, on: Handlers): () => void {
  const doc = root.ownerDocument;
  let wanted: string | undefined;
  return () => {
    const active = root.activeElement as HTMLElement | null;
    const field = active?.tagName === 'TEXTAREA' ? (active as HTMLTextAreaElement) : undefined;
    const caret = field ? ([field.selectionStart, field.selectionEnd] as const) : undefined;
    wanted = active?.dataset?.pbFocus ?? wanted;
    card.setAttribute('aria-label', view.session.title);
    card.replaceChildren(...cardNodes(doc, view, on));
    const next = [...card.querySelectorAll<HTMLElement>('[data-pb-focus]')].find(
      (node) => node.dataset.pbFocus === wanted,
    );
    if (!next || (next as HTMLButtonElement).disabled) return;
    if (active || doc.activeElement === doc.body) next.focus();
    if (caret && next.tagName === 'TEXTAREA') {
      (next as HTMLTextAreaElement).setSelectionRange(...caret);
    }
    wanted = undefined;
  };
}

// Left and right page through the comments, except while the keyboard is in the text field.
function pageKeys(card: HTMLElement, view: View, on: Handlers, boundary: Boundary): void {
  const keys = boundary.guard((event: KeyboardEvent) => {
    const step = Object.hasOwn(PAGE_KEYS, event.key) ? PAGE_KEYS[event.key] : undefined;
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (step === undefined || tag === 'TEXTAREA' || tag === 'INPUT' || view.over) return;
    event.preventDefault();
    on.go(view.page + step);
  });
  card.addEventListener('keydown', keys);
}

function build(opts: ReviewPanelOptions, boundary: Boundary, closed: () => boolean) {
  const { root, session, actions } = opts;
  const doc = root.ownerDocument;
  const view: View = {
    session,
    actions,
    picked: new Map(),
    pending: new Set(),
    sending: false,
    over: false,
    notice: '',
    held: [],
    summary: [],
    page: 0,
    drafts: new Map(),
    added: new Map(),
    adding: new Set(),
  };
  const card = doc.createElement('section');
  card.className = 'pb-review';
  card.setAttribute('role', 'region');
  const live: Live = { view, boundary, closed, render: () => render() };
  const on = handlersOf(live, actions);
  const render = renderer(root, card, view, on);
  render();
  pageKeys(card, view, on, boundary);
  const style = doc.createElement('style');
  style.setAttribute(STYLE, '');
  style.textContent = REVIEW_RULES;
  let print = printOf(session);
  const update = (next: ReviewSession): void => {
    const nextPrint = printOf(next);
    if (closed() || view.over || nextPrint === print) return;
    print = nextPrint;
    // The Send back page stays the last page when a new comment arrives.
    const atEnd = view.page >= lastPage(view);
    view.session = next;
    view.page = atEnd ? lastPage(view) : Math.min(view.page, lastPage(view));
    render();
  };
  const end = (code: string): void => {
    if (closed()) return;
    refuse(view, { code });
    render();
  };
  return { card, style, update, end };
}

export const openReviewPanel: ReviewPanelOpen = (opts) => {
  let owned: HTMLElement[] = [];
  let closed = false;
  const teardown = (): void => {
    closed = true;
    for (const node of owned) node.remove();
  };
  const boundary = createBoundary(teardown);
  const panel = boundary.guard((): ReviewPanel => {
    const { card, style, update, end } = build(opts, boundary, () => closed);
    owned = [card, style];
    opts.root.append(style, card);
    return {
      element: card,
      update: boundary.guard(update),
      end: boundary.guard(end),
      close: boundary.guard(teardown),
    };
  })();
  return boundary.tripped() ? undefined : panel;
};

export type ReviewActivateOptions = {
  win: Window;
  root: ShadowRoot;
  host: HTMLElement;
  endpoint: string;
  /** Resolves once the collector chunk, and with it the add-on that owns unsent comments, is there. */
  load(): Promise<unknown>;
};
export type ReviewActivate = (opts: ReviewActivateOptions) => () => void;
type Scope = { __passback?: Record<string, unknown> };

// The overlay owns what is unsent: this asks it to send all of it and answers with how that settled.
async function flushComments(
  host: HTMLElement,
  load: () => Promise<unknown>,
  onDraft: () => void,
): Promise<boolean> {
  await load();
  return new Promise((resolve) => {
    const flush = (ok: boolean): void => (detail.draft && onDraft(), resolve(ok));
    const detail = { taken: false, draft: false, flush };
    host.dispatchEvent(new CustomEvent('passback:send-all', { detail }));
    if (!detail.taken) resolve(false);
  });
}

type Sender = { send?(el: Element, comment: string): Promise<AddResult> };
type Detail = { load(): Promise<unknown>; routed(): boolean; name(submission: object): void };

// Added detail is one more comment of the session: the collector sends it, the session's route carries it.
function detailSender(doc: Document, { load, routed, name }: Detail) {
  let last: { text: string; token: object } | undefined;
  return async (text: string): Promise<AddResult> => {
    const collector = (await load()) as Sender | null | undefined;
    const send = collector?.send;
    if (typeof send !== 'function' || !routed()) return { ok: false };
    // A retry of the same words is the same submission, so the route keeps its batch id.
    if (last?.text !== text) last = { text, token: { detail: text } };
    name(last.token);
    const result = await send.call(collector, doc.body, text);
    if (result.ok) last = undefined;
    return result;
  };
}

export const activateReview: ReviewActivate = ({ win, root, host, endpoint, load }) => {
  const doc = root.ownerDocument;
  const scope = win as unknown as Scope;
  let panel: ReviewPanel | undefined;
  let route: ReviewRoute | undefined;
  let draftInTheWay = false;
  const unroute = (): void => {
    if (route && scope.__passback?.reviewRoute === route) delete scope.__passback.reviewRoute;
    route = undefined;
  };
  const show = (session: ReviewSession): void => {
    if (panel) return panel.update(session);
    const actions = {
      overrule: (comment: string, label: string) => client.overrule(comment, label),
      finish: async () => {
        draftInTheWay = false;
        const result = await client.finish();
        return !result.ok && draftInTheWay ? { ...result, code: 'draft_unsent' } : result;
      },
      add: detailSender(doc, {
        load,
        routed: () => route !== undefined && scope.__passback?.reviewRoute === route,
        name: (submission) => submissions.name(submission),
      }),
    };
    panel = openReviewPanel({ root, session, actions });
    if (!panel) return stop();
    route = submissions.route;
    scope.__passback = Object.assign(scope.__passback ?? {}, { reviewRoute: route });
  };
  const onUpdate = (update: ReviewUpdate): void => {
    if (update.kind === 'session') show(update.session);
    else if (update.kind === 'ended' && update.code === 'review_not_found') {
      unroute();
      panel?.close();
    } else if (update.kind === 'ended') panel?.end(update.code);
  };
  const client = createReviewSession({
    win,
    endpoint,
    state: () => ({
      visible: doc.visibilityState === 'visible',
      open: panel?.element.isConnected === true,
    }),
    flush: () => flushComments(host, load, () => (draftInTheWay = true)),
    onUpdate,
  });
  // From the start, so a comment sent before the first read answers is still the one its retry names.
  const submissions = routeOf(client, host);
  const visibility = (): void => client.stateChanged();
  doc.addEventListener('visibilitychange', visibility);
  function stop(): void {
    try {
      doc.removeEventListener('visibilitychange', visibility);
      submissions.unwatch();
      client.dispose();
      unroute();
      panel?.close();
    } catch {
      // stopping the review never stops the widget's own teardown
    }
  }
  return stop;
};

// Evaluating the chunk registers the opener, the client and the activation without starting any of them.
const registry = globalThis as Scope;
registry.__passback = Object.assign(registry.__passback ?? {}, {
  reviewPanel: openReviewPanel,
  reviewSession: createReviewSession,
  reviewActivate: activateReview,
});
