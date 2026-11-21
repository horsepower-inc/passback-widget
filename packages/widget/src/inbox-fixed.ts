import type { InboxRowView } from './inbox-sections';
import { verdictOf, type VerdictPort } from './inbox-verdict';
import { reopenOf, type ReopenPort } from './reopen';
import { renderReopenBox } from './reply-box';

type Box = { id: string; text: string; failed: boolean; focus: boolean };
/** What the Fixed rows remember between renders: sends awaiting a snapshot, failures, the open box. */
export type FixedState = { busy: Set<string>; failed: Set<string>; box?: Box };
export type FixedActions = { actions: HTMLElement; line?: string; box?: HTMLElement };
type Options = {
  doc: Document;
  row: InboxRowView;
  verdict?: VerdictPort;
  reopen?: ReopenPort;
  busy: boolean;
  state: FixedState;
  redraw(): void;
};

const NAME_CHARS = 40;
const BOX = '.pb-fx-box textarea';

export const createFixedState = (): FixedState => ({ busy: new Set(), failed: new Set() });
export const isFixable = (row: InboxRowView): boolean =>
  row.status === 'proposed' || row.status === 'verified';

/** A snapshot arrived: sends are answered, failures are stale, and a box for a moved row goes. */
export function settle(state: FixedState, rows: readonly InboxRowView[]): void {
  state.busy.clear();
  state.failed.clear();
  if (state.box && !rows.some((r) => r.id === state.box?.id && isFixable(r))) state.box = undefined;
}

const element = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string) => {
  const node = doc.createElement(tag);
  node.className = cls;
  return node;
};

function action(o: Options, label: string, disabled: boolean, click: () => void) {
  const node = element(o.doc, 'button', 'pb-iv-act');
  node.type = 'button';
  node.textContent = label;
  node.setAttribute('aria-label', `${label}: ${o.row.comment.slice(0, NAME_CHARS)}`);
  node.disabled = disabled;
  if (disabled) node.setAttribute('aria-busy', 'true');
  node.addEventListener('click', (event) => {
    event.stopPropagation();
    click();
  });
  return node;
}

function boxNode(o: Options, box: Box, reopen: ReopenPort): HTMLElement {
  const { doc, state } = o;
  const node = element(doc, 'div', 'pb-fx-box');
  const close = (): void => ((state.box = undefined), o.redraw());
  const { textarea, button } = renderReopenBox(doc, node, {
    onCancel: close,
    onSend(text) {
      box.text = text;
      void reopen.send(box.id, text).then((sent) => {
        if (state.box !== box) return;
        if (sent) state.box = undefined;
        else Object.assign(box, { failed: true, focus: true });
        o.redraw();
      });
    },
  });
  textarea.value = box.text;
  button.disabled = box.text.trim() === '';
  textarea.addEventListener('input', () => (box.text = textarea.value));
  if (box.failed) {
    const line = element(doc, 'p', 'pb-fx-error');
    line.textContent = 'Could not send. Try again.';
    textarea.before(line);
  }
  // Esc cancels this box only; the panel keeps its place.
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') event.stopPropagation();
  });
  node.addEventListener('click', (event) => event.stopPropagation());
  return node;
}

/** Fills the action area of a proposed or verified row; undefined means the row keeps its Open action. */
export function renderFixedActions(o: Options): FixedActions | undefined {
  const { row, verdict, reopen, state } = o;
  if (!isFixable(row) || (!verdict && !reopen)) return undefined;
  const actions = element(o.doc, 'div', 'pb-iv-acts');
  if (verdict) {
    actions.append(
      action(o, 'Accept', o.busy, () => {
        if (verdict.accept(row.id)) {
          state.busy.add(row.id);
          state.failed.delete(row.id);
        } else state.failed.add(row.id);
        o.redraw();
      }),
    );
  }
  if (reopen) {
    actions.append(
      action(o, 'Still wrong', o.busy, () => {
        state.box = { id: row.id, text: '', failed: false, focus: true };
        o.redraw();
      }),
    );
  }
  const box = state.box?.id === row.id && reopen ? boxNode(o, state.box, reopen) : undefined;
  return {
    actions,
    line: state.failed.has(row.id) ? 'Could not accept. Try again.' : undefined,
    box,
  };
}

/** The footer's Accept all N for the Fixed tab; undefined without the verdict port. */
function acceptAllNode(o: {
  doc: Document;
  verdict?: VerdictPort;
  ids: readonly string[];
  state: FixedState;
  redraw(): void;
}): HTMLButtonElement | undefined {
  const { doc, verdict, ids, state } = o;
  if (!verdict) return undefined;
  const node = element(doc, 'button', 'pb-iv-all');
  node.type = 'button';
  node.textContent = `Accept all ${ids.length}`;
  node.disabled = ids.length === 0 || state.busy.size > 0;
  node.addEventListener('click', () => {
    if (verdict.acceptAll(ids) > 0) for (const id of ids) state.busy.add(id);
    o.redraw();
  });
  return node;
}

type Listed = { section: string; row?: InboxRowView };
type Win = Window & typeof globalThis;
/** The Fixed rows of one view: the panel calls it per row, for the footer and after each render. */
export type Fixed = {
  settle(rows: readonly InboxRowView[]): void;
  row<T extends HTMLElement>(node: T, item: Listed): T;
  foot<T extends HTMLElement>(node: T, active: string, items: readonly Listed[]): T;
  refocus(root: HTMLElement): boolean;
};

// The focused element, looked up through the shadow roots it sits in.
function deepActive(doc: Document): Element | null {
  let active = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

export function createFixed(win: Window, redraw: () => void): Fixed {
  const state = createFixedState();
  const ports = () => ({ verdict: verdictOf(win), reopen: reopenOf(win as Win), state, redraw });
  return {
    settle: (rows) => settle(state, rows),
    row(node, { section, row }) {
      if (section !== 'fixed' || !row) return node;
      const doc = node.ownerDocument;
      if (state.box && deepActive(doc)?.matches(BOX)) state.box.focus = true;
      const fixed = renderFixedActions({ doc, row, ...ports(), busy: state.busy.has(row.id) });
      if (!fixed) return node;
      node.querySelector('.pb-iv-act')?.replaceWith(fixed.actions);
      const line = node.querySelector('.pb-iv-line');
      if (line && fixed.line) line.textContent = fixed.line;
      if (fixed.box) node.append(fixed.box);
      return node;
    },
    foot(node, active, items) {
      if (active !== 'fixed') return node;
      const ids = items.flatMap((i) =>
        i.section === 'fixed' && i.row && isFixable(i.row) ? [i.row.id] : [],
      );
      const accept = acceptAllNode({ doc: node.ownerDocument, ids, ...ports() });
      if (accept) node.querySelector('.pb-iv-total')?.after(accept);
      return node;
    },
    refocus(root) {
      if (!state.box?.focus) return false;
      state.box.focus = false;
      root.querySelector<HTMLElement>(BOX)?.focus();
      return true;
    },
  };
}
