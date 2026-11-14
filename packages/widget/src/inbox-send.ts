import { destOf, type Dest } from './kept';

type Doc = Document;
export type DestCounts = Record<Dest, number>;
export type Footer = {
  shown: number;
  counts: DestCounts;
  /** The page's script has a site endpoint: only then the tracker half exists. */
  site: boolean;
  /** The tracker's name when the relay offers filing to it. */
  offer: string | undefined;
};

export const make = <K extends keyof HTMLElementTagNameMap>(
  doc: Doc,
  tag: K,
  cls: string,
  text?: string,
) => {
  const node = doc.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
export const button = (doc: Doc, cls: string, text: string, click: (event: MouseEvent) => void) => {
  const node = make(doc, 'button', cls, text);
  node.type = 'button';
  node.addEventListener('click', click);
  return node;
};

export const hasSite = (doc: Doc): boolean =>
  [...doc.querySelectorAll('script[data-passback-endpoint]')].some(
    (s) => (s.getAttribute('data-passback-endpoint') ?? '') !== '',
  );

export const destCounts = (rows: readonly { dest?: Dest }[]): DestCounts => {
  const counts = { agent: 0, tracker: 0 };
  for (const row of rows) counts[destOf(row)] += 1;
  return counts;
};

/** Asks the send path to send the kept comments of one destination. */
export const sendAll = (host: Element, dest: Dest): void => {
  host.dispatchEvent(new CustomEvent('passback:send-all', { detail: { dest } }));
};

/** The Agent | tracker switch of a To send row; `pick` is told the half that was clicked. */
export function destSwitch(
  doc: Doc,
  dest: Dest,
  tracker: string | undefined,
  pick: (dest: Dest) => void,
): HTMLElement {
  const group = make(doc, 'div', 'pb-iv-dest');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Send to');
  const half = (to: Dest, label: string) => {
    const node = button(doc, 'pb-iv-dest-btn', label, (event) => {
      event.stopPropagation();
      pick(to);
    });
    node.dataset.dest = to;
    node.setAttribute('aria-pressed', String(dest === to));
    return node;
  };
  group.append(half('agent', 'Agent'), half('tracker', tracker ?? 'Tracker'));
  const filing = group.lastElementChild as HTMLButtonElement;
  if (tracker === undefined) {
    filing.disabled = true;
    filing.title = 'Connect a tracker';
  }
  return group;
}

/** The total and the buttons that send the kept comments, one per destination. */
export function footerNode(doc: Doc, mac: boolean, host: Element, info: Footer): HTMLElement {
  const foot = make(doc, 'div', 'pb-iv-foot');
  const { shown, counts, site, offer } = info;
  foot.append(make(doc, 'span', 'pb-iv-total', `${shown} ${shown === 1 ? 'comment' : 'comments'}`));
  const go = button(
    doc,
    'pb-iv-send',
    `Send ${counts.agent} to agent ${mac ? '⌘↵' : 'Ctrl+Enter'}`,
    () => sendAll(host, 'agent'),
  );
  go.disabled = counts.agent === 0;
  foot.append(go);
  if (site) {
    const text =
      offer === undefined
        ? 'Connect a tracker'
        : `File ${counts.tracker} in ${offer} ${mac ? '⌘⇧↵' : 'Ctrl+Shift+Enter'}`;
    const file = button(doc, 'pb-iv-file', text, () => sendAll(host, 'tracker'));
    file.disabled = offer === undefined || counts.tracker === 0;
    foot.append(file);
  }
  return foot;
}
