import { boxNode, buttonNode, currentLabel, textNode, type Handlers, type View } from './review-view';

const SEND_BACK = 'Send back to fix';
const FEATURE = 'feature';

function safeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/** A link to the feature page, only for an http(s) address; otherwise its words as plain text. */
export function featureLink(doc: Document, view: View, words: string): HTMLElement {
  const href = safeUrl(view.session.featureUrl);
  if (!href) return textNode(doc, 'span', '', words);
  const link = textNode(doc, 'a', 'pb-review-link', words);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  link.dataset.pbFocus = '#link';
  return link;
}

/** The refusal or end notice, the held comments and the finish summary, each as text. */
export function resultNodes(doc: Document, view: View): HTMLElement[] {
  const notice = textNode(doc, 'p', 'pb-review-notice', view.notice);
  notice.setAttribute('role', 'status');
  const nodes: HTMLElement[] = [notice];
  if (view.held.length > 0) {
    const list = doc.createElement('ul');
    list.className = 'pb-review-held';
    for (const id of view.held) {
      const known = view.session.comments.find((comment) => comment.id === id);
      list.append(textNode(doc, 'li', 'pb-review-row', known?.text ?? id));
    }
    nodes.push(list);
  }
  if (view.summary.length > 0) {
    const rows = view.summary.map(({ label, value }) =>
      textNode(doc, 'p', 'pb-review-row', `${label}: ${value}`),
    );
    nodes.push(boxNode(doc, 'pb-review-summary', ...rows));
  }
  return nodes;
}

function counts(doc: Document, view: View): HTMLElement {
  const list = doc.createElement('dl');
  list.className = 'pb-review-sum';
  for (const { key, label } of view.session.labels) {
    const n = view.session.comments.filter((comment) => currentLabel(view, comment) === key);
    list.append(textNode(doc, 'dt', '', label), textNode(doc, 'dd', '', String(n.length)));
  }
  return list;
}

function lead(doc: Document, view: View): HTMLElement {
  const name = view.session.labels.find(({ key }) => key === FEATURE)?.label ?? 'This feature';
  const n = view.session.comments.filter((c) => currentLabel(view, c) === FEATURE).length;
  const line = textNode(doc, 'p', 'pb-note pb-review-lead', '');
  line.append(
    `The agent fixes the ${n} comment${n === 1 ? '' : 's'} sorted `,
    textNode(doc, 'b', '', name),
    '. Then you get a new round and check each fix: Fixed or Still wrong.',
  );
  return line;
}

function unsortedLines(doc: Document, view: View, on: Handlers): HTMLElement[] {
  return view.session.comments.flatMap((comment, index) => {
    if (currentLabel(view, comment) !== null) return [];
    const line = textNode(doc, 'p', 'pb-note pb-review-warn', `Not sorted: “${comment.text}” `);
    const sort = buttonNode(doc, 'pb-review-link', 'Sort it', `sort:${comment.id}`, () =>
      on.go(index),
    );
    line.append(sort);
    return [line];
  });
}

/** The last page: what Send back does, the counts per label, and every comment not sorted yet. */
export function summaryPage(doc: Document, view: View, on: Handlers): HTMLElement[] {
  const entry = view.session.finish.find(({ key }) => key === 'send_back');
  const pass = textNode(doc, 'p', 'pb-note', 'Nothing to fix? ');
  pass.append(featureLink(doc, view, 'Pass it on the feature page'), '.');
  const note =
    view.actions && entry?.note ? [textNode(doc, 'p', 'pb-note pb-review-note', entry.note)] : [];
  return [
    textNode(doc, 'p', 'pb-review-text pb-review-strong', SEND_BACK),
    lead(doc, view),
    counts(doc, view),
    textNode(doc, 'p', 'pb-note', 'Bugs and ideas become their own tickets either way.'),
    pass,
    ...note,
    ...unsortedLines(doc, view, on),
  ];
}

/** The Send back button, disabled while a comment is unsorted, the entry is off, or an action runs. */
export function sendButton(doc: Document, view: View, on: Handlers): HTMLButtonElement[] {
  const entry = view.session.finish.find(({ key }) => key === 'send_back');
  if (!view.actions || !entry) return [];
  const button = buttonNode(doc, 'pb-send pb-review-send', SEND_BACK, '#send', on.send);
  const unsorted = view.session.comments.some((comment) => currentLabel(view, comment) === null);
  button.disabled =
    !entry.enabled || unsorted || view.over || view.sending || view.pending.size > 0;
  return [button];
}
