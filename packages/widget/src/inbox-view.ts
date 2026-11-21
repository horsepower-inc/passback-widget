import { createInboxFeed, type InboxFeed } from './inbox-feed';
import { createHeld, renderHeldActions, type HeldView } from './inbox-held';
import { createFixed, type Fixed } from './inbox-fixed';
import {
  countsOf,
  filedLine,
  type Counts,
  ORDER,
  stateLine,
  type InboxRowView,
  type Section,
  type SectionKey,
} from './inbox-sections';
import { createHighlight } from './inbox-highlight';
import { rowNumber } from './inbox-numbers';
import { openRow, rowOf, showTask, type TaskState } from './inbox-task';
import { button, destCounts, destSwitch, footerNode, hasSite, make, sendAll } from './inbox-send';
import { inboxViewRules } from './inbox-view-styles';
import { trackerOffer } from './tracker-offer';
import { destOf, type Dest } from './kept';
import type { RowAction } from './tray-view';

export type InboxViewOptions = {
  content: HTMLElement;
  host: Element;
  win: Window;
  onOpen?: (id: string) => void;
};
type KeptRow = {
  n?: number;
  comment: string;
  locked?: boolean;
  dest?: Dest;
  act(a: RowAction): void;
};
type Item = { section: Section; key: string; comment: string; line: string } & (
  | { kept: KeptRow; row?: undefined }
  | { row: InboxRowView; kept?: undefined }
  | { kept?: undefined; row?: undefined } // a comment filed in the tracker
);
type FiledRow = { comment: string; ref: string };

type RowAct = {
  open(id: string): void;
  hover(id: string | null): void;
  switchable: boolean;
  tracker: string | undefined;
};
const STYLE = 'data-pb-iv-style';
const LABELS: Record<SectionKey, string> = {
  all: 'All',
  needs: 'Needs you',
  send: 'To send',
  working: 'Working',
  fixed: 'Fixed',
  tracker: 'Tracker',
};

// publishes the kept list as rows (an array, or a function returning one); absent means none.
function keptRows(win: Window): KeptRow[] {
  try {
    const kept = (win as unknown as { __passback?: { kept?: unknown } }).__passback?.kept;
    const rows = typeof kept === 'function' ? (kept as () => unknown)() : kept;
    return Array.isArray(rows) ? (rows as KeptRow[]) : [];
  } catch {
    return [];
  }
}

// publishes the comments filed from the panel as a function; absent, throwing or malformed means none.
function filedRows(win: Window): FiledRow[] {
  try {
    const filed = (win as unknown as { __passback?: { filed?: unknown } }).__passback?.filed;
    const rows = typeof filed === 'function' ? (filed as () => unknown)() : undefined;
    if (!Array.isArray(rows)) return [];
    return rows.filter(
      (e): e is FiledRow =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as FiledRow).comment === 'string' &&
        typeof (e as FiledRow).ref === 'string',
    );
  } catch {
    return [];
  }
}

const isMac = (win: Window): boolean => /mac|iphone|ipad/i.test(win.navigator?.platform ?? '');
const inField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (/^(input|textarea|select)$/i.test(target.tagName) || target.isContentEditable);

type Doc = Document;

type Menu = { tabs: readonly SectionKey[]; active: SectionKey; counts: Counts };
function menuNode(doc: Doc, m: Menu, select: (key: SectionKey) => void): HTMLElement {
  const bar = make(doc, 'div', 'pb-iv-menu');
  bar.setAttribute('role', 'tablist');
  for (const key of m.tabs) {
    const tab = button(doc, 'pb-iv-tab', LABELS[key], () => select(key));
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(key === m.active));
    tab.dataset.key = key;
    if (m.counts[key] > 0) {
      const count = make(doc, 'span', 'pb-iv-count', String(m.counts[key]));
      if (key === 'needs') count.setAttribute('data-needs', '');
      tab.append(count);
    }
    bar.append(tab);
  }
  return bar;
}

function rowNode(doc: Doc, win: Window, item: Item, selected: boolean, act: RowAct) {
  const node = make(doc, 'div', 'pb-iv-row');
  node.setAttribute('role', 'option');
  node.setAttribute('aria-selected', String(selected));
  node.tabIndex = selected ? 0 : -1;
  node.dataset.key = item.key;
  if (item.section === 'fixed' || item.section === 'tracker') node.setAttribute('data-muted', '');
  const n = item.kept ? item.kept.n : item.row && rowNumber(win, item.row.id);
  node.append(make(doc, 'span', 'pb-iv-n', n === undefined ? '' : String(n)));
  node.append(make(doc, 'span', 'pb-iv-comment', item.comment));
  node.append(make(doc, 'span', 'pb-iv-line', item.line));
  const { kept, row } = item;
  if (!kept && !row) return node;
  if (kept && act.switchable) {
    const pick = (dest: Dest) => kept.act(dest === 'tracker' ? 'to-tracker' : 'to-agent');
    node.append(destSwitch(doc, destOf(kept), act.tracker, pick));
  }
  node.append(button(doc, 'pb-iv-act', kept ? 'Delete' : 'Open', () => kept?.act('delete')));
  if (row) {
    node.setAttribute('data-open', '');
    node.addEventListener('click', () => act.open(row.id));
    node.addEventListener('pointerenter', () => act.hover(row.id));
    node.addEventListener('pointerleave', () => act.hover(null));
  }
  return node;
}

type Listing = { items: Item[]; active: SectionKey; selected: number; truncated: boolean };
function listNode(
  doc: Doc,
  win: Window,
  l: Listing,
  fx: Fixed,
  held: HeldView,
  act: RowAct,
): HTMLElement {
  const box = make(doc, 'div', 'pb-iv-list');
  box.setAttribute('role', 'listbox');
  if (l.truncated)
    box.append(make(doc, 'div', 'pb-iv-note', 'Only the newest comments are shown.'));
  if (l.items.length === 0) box.append(make(doc, 'div', 'pb-iv-empty', 'Nothing here.'));
  let group: Section | undefined;
  l.items.forEach((item, index) => {
    if (l.active === 'all' && item.section !== group) {
      group = item.section;
      const total = l.items.filter((i) => i.section === group).length;
      box.append(make(doc, 'div', 'pb-iv-group', `${LABELS[group]} ${total}`));
    }
    const node = rowNode(doc, win, item, index === l.selected, act);
    const args = held.args(item);
    box.append(fx.row(held.put(node, args && renderHeldActions(args)), item));
  });
  return box;
}

function gather(
  win: Window,
  feed: InboxFeed,
  active: SectionKey,
  held: HeldView,
  filed: readonly FiledRow[],
  tracker: string | undefined,
): Item[] {
  const all: Item[] = keptRows(win).map((kept, i) => ({
    section: 'send',
    key: `k${i}`,
    comment: kept.comment,
    line: stateLine(),
    kept,
  }));
  all.push(...held.items(feed.rows()));
  filed.forEach((f, i) =>
    all.push({
      section: 'tracker',
      key: `f${i}`,
      comment: f.comment,
      line: filedLine(tracker, f.ref),
    }),
  );
  const shown = all.filter((i) => active === 'all' || i.section === active);
  return shown.sort((a, b) => ORDER.indexOf(a.section) - ORDER.indexOf(b.section));
}

// Sends one destination's kept comments; filing also needs the site and an offer.
function sendKept(win: Window, host: Element, site: boolean, dest: Dest): void {
  const n = destCounts(keptRows(win))[dest];
  if (n > 0 && (dest === 'agent' || (site && trackerOffer(win)))) sendAll(host, dest);
}

const chord = (event: KeyboardEvent): Intent => (event.shiftKey ? 'file' : 'send');
type Intent = 'send' | 'file' | 'open' | number | { tab: SectionKey };
// Digits switch tabs, arrows move the selection, Enter opens; none of them act inside a field.
function keyIntent(event: KeyboardEvent, tabs: readonly SectionKey[]): Intent | undefined {
  const { key } = event;
  if (inField(event.target)) return undefined;
  if (key === 'Enter' && (event.metaKey || event.ctrlKey)) return chord(event);
  if (event.altKey || event.metaKey || event.ctrlKey) return undefined;
  if (key === 'ArrowDown' || key === 'ArrowUp') return key === 'ArrowDown' ? 1 : -1;
  if (key === 'Enter') return event.target instanceof HTMLButtonElement ? undefined : 'open';
  const tab = /^[1-6]$/.test(key) ? tabs[Number(key) - 1] : undefined;
  return tab ? { tab } : undefined;
}

// The focused tab's key and whether a row has focus, so a redraw can give it back.
function focusOf(root: HTMLElement): [string | undefined, boolean] {
  const focused = (root.getRootNode() as ShadowRoot | Document).activeElement;
  const inside = focused instanceof HTMLElement && root.contains(focused);
  const tab = inside && focused.matches('.pb-iv-tab') ? focused.dataset.key : undefined;
  return [tab, inside && focused.matches('.pb-iv-row')];
}

const styleNode = (doc: Doc): HTMLStyleElement => {
  const style = doc.createElement('style');
  style.setAttribute(STYLE, '');
  style.textContent = inboxViewRules();
  return style;
};

const clamp = (value: number, max: number): number => Math.max(0, Math.min(max, value));

/** Mounts the section menu, the list of the chosen section and the footer into the panel content. */
export function mountInboxView(opts: InboxViewOptions): () => void {
  const { content, host, win, onOpen } = opts;
  const doc = content.ownerDocument;
  const [held, mac, fixed] = [createHeld(win, doc), isMac(win), createFixed(win, () => render())];
  let active: SectionKey = 'all';
  let selected = 0;
  let items: Item[] = [];
  let disposed = false;
  let openId: string | undefined;
  let task: TaskState = { draft: '', failed: false };
  const light = createHighlight(host);
  const style = styleNode(doc);
  const root = make(doc, 'div', 'pb-iv');
  root.tabIndex = -1;
  content.append(style, root);
  const feed = createInboxFeed(win, () => (fixed.settle(feed.rows()), held.settle(), render()));
  const site = hasSite(doc);
  const send = (dest: Dest): void => sendKept(win, host, site, dest);
  const select = (key: SectionKey): void => ((active = key), (selected = 0), render());

  const open = (id: string): void => {
    onOpen?.(id);
    if (openId !== id) task = { draft: '', failed: false };
    openId = id;
    render();
    root.querySelector<HTMLElement>('.pb-it-box:not(:disabled)')?.focus();
  };
  const close = (): void => {
    openId = undefined;
    render();
    focusRow();
  };

  function render(): void {
    if (disposed) return;
    light.hover(null);
    const row = openRow(feed.rows(), openId);
    light.open((openId = row?.id) ?? null);
    if (row) return showTask(root, row, { win, mac, state: task, held, close, redraw: render });
    const [tabFocus, rowFocus] = focusOf(root);
    const kept = keptRows(win);
    const offer = trackerOffer(win);
    const filed = site ? filedRows(win) : [];
    items = gather(win, feed, active, held, filed, offer);
    selected = clamp(selected, items.length - 1);
    const counts = countsOf(feed.rows(), kept.length, held.shelf(), filed.length);
    const acts = { open, hover: light.hover, switchable: site, tracker: offer };
    const info = { shown: items.length, counts: destCounts(kept), site, offer };
    const listing = { items, active, selected, truncated: feed.truncated() };
    root.replaceChildren(
      menuNode(doc, { tabs: held.tabs, active, counts }, select),
      listNode(doc, win, listing, fixed, held, acts),
      fixed.foot(footerNode(doc, mac, host, info), active, items),
    );
    if (tabFocus && held.tabs.includes(tabFocus as SectionKey))
      root.querySelector<HTMLElement>(`.pb-iv-tab[data-key="${tabFocus}"]`)?.focus();
    if (!fixed.refocus(root) && rowFocus) focusRow();
  }
  function focusRow(): void {
    root.querySelector<HTMLElement>('.pb-iv-row[tabindex="0"]')?.focus();
  }

  const onKey = (event: KeyboardEvent): void => {
    if (openId !== undefined) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      return close();
    }
    const intent = keyIntent(event, held.tabs);
    if (!intent) return;
    if (intent !== 'open') event.preventDefault();
    if (intent === 'send' || intent === 'file') send(intent === 'send' ? 'agent' : 'tracker');
    else if (intent === 'open') {
      const row = rowOf(event, items, selected);
      if (row) open(row.id);
    } else if (typeof intent === 'number') {
      selected = clamp(selected + intent, items.length - 1);
      render();
      focusRow();
    } else select(intent.tab);
  };

  // The keys work anywhere in the panel, its header buttons included, not only in the content.
  const panel = content.parentElement ?? content;
  panel.addEventListener('keydown', onKey);
  host.addEventListener('passback:sync', render);
  render();

  return () => {
    if (disposed) return;
    disposed = true;
    panel.removeEventListener('keydown', onKey);
    host.removeEventListener('passback:sync', render);
    feed.dispose();
    light.dispose();
    style.remove();
    root.remove();
  };
}
