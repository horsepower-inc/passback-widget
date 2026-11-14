import type { ReviewComment } from './review-session';
import {
  boxNode,
  buttonNode,
  currentLabel,
  movedByTester,
  textNode,
  type Handlers,
  type View,
} from './review-view';

// What each of the tracker's three label keys does; the names still come from the server.
const MEANING: Record<string, string> = {
  feature: 'The agent fixes it in this feature before it can pass.',
  bug: 'Filed as its own bug. It does not hold this feature.',
  idea: 'Saved as an idea for later. It does not hold this feature.',
};
const UNSORTED = 'Not sorted yet: the agent could not tell. Pick one.';
const MOVED = 'You moved it here.';
const AGENT = 'The agent sorted it here. Change it if that is wrong.';
export const ADD_PLACEHOLDER = 'Add more detail to this comment…';

export const meaningOf = (key: string | null): string | undefined =>
  key !== null && Object.hasOwn(MEANING, key) ? MEANING[key] : undefined;

function labelButtons(doc: Document, comment: ReviewComment, view: View, on: Handlers) {
  const current = currentLabel(view, comment);
  const locked = !view.actions || view.over || view.sending || view.pending.has(comment.id);
  const buttons = view.session.labels.map(({ key, label }) => {
    const button = buttonNode(doc, 'pb-ico', label, `label:${key}`, () => {
      if (key !== currentLabel(view, comment)) on.pick(comment, key);
    });
    button.dataset.pbLabel = key;
    button.setAttribute('aria-pressed', String(key === current));
    button.disabled = locked;
    return button;
  });
  const row = boxNode(doc, 'pb-review-labels', ...buttons);
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Where does it go?');
  return row;
}

// The chosen label's meaning, then who put the comment there.
function meaningLine(doc: Document, comment: ReviewComment, view: View): HTMLElement {
  const current = currentLabel(view, comment);
  const line = textNode(doc, 'p', 'pb-note pb-review-meaning', '');
  if (current === null) {
    line.append(textNode(doc, 'span', 'pb-review-unsorted', UNSORTED));
    return line;
  }
  const who = movedByTester(view, comment) ? MOVED : AGENT;
  const meaning = meaningOf(current);
  line.textContent = meaning ? `${meaning} ${who}` : who;
  return line;
}

function thread(doc: Document, lines: readonly string[]): HTMLElement[] {
  if (lines.length === 0) return [];
  const rows = lines.map((text) => {
    const row = textNode(doc, 'p', 'pb-note', ` ${text}`);
    row.prepend(textNode(doc, 'span', 'pb-review-added', 'Added:'));
    return row;
  });
  return [boxNode(doc, 'pb-review-thread', ...rows)];
}

function detailField(doc: Document, comment: ReviewComment, view: View, on: Handlers) {
  if (!view.actions?.add) return [];
  const field = doc.createElement('textarea');
  field.className = 'pb-input pb-review-field';
  field.placeholder = ADD_PLACEHOLDER;
  field.setAttribute('aria-label', ADD_PLACEHOLDER);
  field.dataset.pbFocus = '#field';
  field.value = view.drafts.get(comment.id) ?? '';
  field.disabled = view.over || view.adding.has(comment.id);
  field.addEventListener('input', () => on.draft(comment, field.value));
  // Its own box, so an add-on that hangs a control under a widget field puts it right here.
  return [boxNode(doc, 'pb-review-detail', field)];
}

/** One comment's page: the comment, the agent's question, where it goes and what that means, and added detail. */
export function commentPage(
  doc: Document,
  comment: ReviewComment,
  view: View,
  on: Handlers,
): HTMLElement[] {
  const nodes: HTMLElement[] = [
    textNode(doc, 'p', 'pb-note pb-review-kind', 'Your comment'),
    textNode(doc, 'p', 'pb-review-text', comment.text),
  ];
  if (comment.tone === 'ask' && comment.question) {
    nodes.push(textNode(doc, 'p', 'pb-note pb-review-question', `Agent asks: ${comment.question}`));
  }
  nodes.push(
    textNode(doc, 'p', 'pb-note pb-review-kind', 'Where does it go?'),
    labelButtons(doc, comment, view, on),
    meaningLine(doc, comment, view),
    ...thread(doc, view.added.get(comment.id) ?? []),
    ...detailField(doc, comment, view, on),
  );
  return nodes;
}

/** The footer buttons of a comment page: Add detail when the session can send one, then Next. */
export function commentActions(
  doc: Document,
  comment: ReviewComment,
  view: View,
  on: Handlers,
): HTMLButtonElement[] {
  const next = buttonNode(doc, 'pb-ico pb-review-next', 'Next', '#next', () =>
    on.go(view.page + 1),
  );
  if (!view.actions?.add) return [next];
  const add = buttonNode(doc, 'pb-ico pb-review-add', 'Add detail', '#add', () => on.add(comment));
  add.disabled = view.over || view.adding.has(comment.id);
  return [add, next];
}
