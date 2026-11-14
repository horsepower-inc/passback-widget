import type { FinishResult, OverruleResult, ReviewComment, ReviewSession } from './review-session';

/** What an Add detail send answers: the overlay's own send result, of which the panel reads ok and code. */
export type AddResult = { ok: boolean; code?: string };
export type ReviewActions = {
  overrule(comment: string, label: string): Promise<OverruleResult>;
  finish(): Promise<FinishResult>;
  /** Sends text as a new review comment through the session's own batch path; absent, there is no Add detail. */
  add?(text: string): Promise<AddResult>;
};
export type View = {
  session: ReviewSession;
  actions?: ReviewActions;
  picked: Map<string, { key: string; from: string | null }>;
  pending: Set<string>;
  sending: boolean;
  over: boolean;
  notice: string;
  held: string[];
  summary: { label: string; value: string }[];
  /** The page shown: one per comment, then the Send back page at comments.length. */
  page: number;
  drafts: Map<string, string>;
  added: Map<string, string[]>;
  adding: Set<string>;
};
export type Handlers = {
  pick(comment: ReviewComment, key: string): void;
  send(): void;
  go(page: number): void;
  draft(comment: ReviewComment, text: string): void;
  add(comment: ReviewComment): void;
};

// Every server string reaches the DOM through this one text setter, never as markup.
export function textNode<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/** A widget button: `.pb-ico` (wide when it carries words) or `.pb-send`; the focus key keeps the keyboard on it across a rebuild. */
export function buttonNode(
  doc: Document,
  className: string,
  text: string,
  focus: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = textNode(doc, 'button', className, text);
  button.type = 'button';
  button.dataset.pbFocus = focus;
  if (className.split(' ').includes('pb-ico') && text !== '') button.setAttribute('data-wide', '');
  button.addEventListener('click', onClick);
  return button;
}

export function boxNode(doc: Document, className: string, ...children: Node[]): HTMLDivElement {
  const box = doc.createElement('div');
  box.className = className;
  box.append(...children);
  return box;
}

// A label the tester chose stands until the server names another one for that comment.
export function currentLabel(view: View, comment: ReviewComment): string | null {
  const picked = view.picked.get(comment.id);
  return picked && picked.from === comment.label ? picked.key : comment.label;
}

export function movedByTester(view: View, comment: ReviewComment): boolean {
  const picked = view.picked.get(comment.id);
  return comment.overruled || (picked !== undefined && picked.from === comment.label);
}

export const sortedCount = (view: View): number =>
  view.session.comments.filter((comment) => currentLabel(view, comment) !== null).length;

/** The last page is the Send back page; a session without comments shows only that one. */
export const lastPage = (view: View): number => view.session.comments.length;
