import { commentActions, commentPage } from './review-page';
import type { ReviewSession } from './review-session';
import { featureLink, resultNodes, sendButton, summaryPage } from './review-summary';
import {
  boxNode,
  buttonNode,
  lastPage,
  sortedCount,
  textNode,
  type Handlers,
  type View,
} from './review-view';

export type { AddResult, Handlers, ReviewActions, View } from './review-view';

const NS = 'http://www.w3.org/2000/svg';
const PREVIOUS = 'M10 3 5 8l5 5';
const NEXT = 'm6 3 5 5-5 5';

function chevron(doc: Document, path: string, label: string, onClick: () => void) {
  const button = buttonNode(doc, 'pb-ico', '', `#pager:${label}`, onClick);
  button.title = label;
  button.setAttribute('aria-label', label);
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const line = doc.createElementNS(NS, 'path');
  line.setAttribute('d', path);
  svg.append(line);
  button.append(svg);
  return button;
}

function pager(doc: Document, view: View, on: Handlers): HTMLElement {
  const last = lastPage(view);
  const back = chevron(doc, PREVIOUS, 'Previous', () => on.go(view.page - 1));
  const forth = chevron(doc, NEXT, 'Next page', () => on.go(view.page + 1));
  back.disabled = view.page === 0;
  forth.disabled = view.page >= last;
  const where = view.page < last ? `${view.page + 1} / ${last}` : 'Done';
  const at = textNode(doc, 'span', 'pb-note pb-review-where', where);
  return boxNode(doc, 'pb-review-pager', back, at, forth);
}

function header(doc: Document, view: View, on: Handlers): HTMLElement {
  const { session } = view;
  const round = (session as ReviewSession & { roundLabel?: unknown }).roundLabel;
  const meta = boxNode(
    doc,
    'pb-note pb-review-meta',
    textNode(doc, 'span', 'pb-review-version', session.version),
    doc.createTextNode(' · '),
    textNode(
      doc,
      'span',
      'pb-review-round',
      round && typeof round === 'string' ? round : `Round ${session.round}`,
    ),
  );
  const heading = boxNode(doc, '', textNode(doc, 'h2', 'pb-review-title', session.title), meta);
  const head = boxNode(doc, 'pb-review-head', heading);
  if (!view.over) head.append(pager(doc, view, on));
  return head;
}

function footer(doc: Document, buttons: HTMLElement[], count: string): HTMLElement {
  return boxNode(
    doc,
    'pb-bar',
    textNode(doc, 'span', 'pb-note pb-review-count', count),
    boxNode(doc, 'pb-actions', ...buttons),
  );
}

type Body = { nodes: HTMLElement[]; bar: HTMLElement };

function body(doc: Document, view: View, on: Handlers): Body {
  if (view.over) {
    // Finished, expired or a closed round: the same frame, the end wording and the feature link.
    const open = textNode(doc, 'p', 'pb-note', '');
    open.append(featureLink(doc, view, 'Open feature'));
    const nodes = [...resultNodes(doc, view), open];
    return { nodes, bar: footer(doc, sendButton(doc, view, on), '') };
  }
  const comment = view.session.comments[view.page];
  if (!comment) {
    const nodes = [...summaryPage(doc, view, on), ...resultNodes(doc, view)];
    return { nodes, bar: footer(doc, sendButton(doc, view, on), '') };
  }
  const count = `${sortedCount(view)} of ${view.session.comments.length} sorted`;
  const nodes = [...commentPage(doc, comment, view, on), ...resultNodes(doc, view)];
  return { nodes, bar: footer(doc, commentActions(doc, comment, view, on), count) };
}

/** The panel's content for one state of the view; the panel owns the card, its state and its lifecycle. */
export function cardNodes(doc: Document, view: View, on: Handlers): HTMLElement[] {
  const { nodes, bar } = body(doc, view, on);
  return [header(doc, view, on), boxNode(doc, 'pb-review-rule'), ...nodes, bar];
}
