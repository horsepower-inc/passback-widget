import { ORDER, sectionOf, stateLine, type InboxRowView, type Section } from './inbox-sections';
import { verdictOf, type VerdictPort } from './inbox-verdict';

/** What the held actions remember between renders: sends awaiting a snapshot and their lines. */
export type HeldState = { busy: Set<string>; lines: Map<string, string> };
type Held = { actions: HTMLElement; line?: string };
type Listed = { section: Section; row?: InboxRowView };
type Options = {
  doc: Document;
  row: InboxRowView;
  verdict?: VerdictPort;
  /** Whether the view shows the Tracker tab; without it a parked row could not be unparked. */
  tracker: boolean;
  busy: boolean;
  state?: HeldState;
};

const NAME_CHARS = 40;

export const createHeldState = (): HeldState => ({ busy: new Set(), lines: new Map() });

function button(doc: Document, cls: string, label: string, name: string, busy: boolean) {
  const node = doc.createElement('button');
  node.className = cls;
  node.type = 'button';
  node.textContent = label;
  node.setAttribute('aria-label', `${label}: ${name.slice(0, NAME_CHARS)}`);
  node.disabled = busy;
  if (busy) node.setAttribute('aria-busy', 'true');
  return node;
}

const busyOn = (node: HTMLButtonElement): void => {
  node.disabled = true;
  node.setAttribute('aria-busy', 'true');
};

/** Park (a sent comment nobody picked up) or Unpark (a parked one) for a Working or Tracker row. */
export function renderHeldActions(o: Options): Held | undefined {
  const { doc, row, verdict, state } = o;
  if (!verdict) return undefined;
  const parked = row.parked === true;
  const park = !parked && o.tracker && row.status === 'new';
  const unpark = parked && row.status !== 'accepted';
  if (!park && !unpark) return undefined;
  const word = park ? 'park' : 'unpark';
  const node = button(doc, 'pb-iv-act', park ? 'Park' : 'Unpark', row.comment, o.busy);
  node.addEventListener('click', (event) => {
    event.stopPropagation();
    const ok = park ? verdict.park(row.id) : verdict.unpark(row.id);
    if (ok) {
      state?.busy.add(row.id);
      return busyOn(node);
    }
    const text = `Could not ${word}. Try again.`;
    state?.lines.set(row.id, text);
    const line = node.closest('.pb-iv-row')?.querySelector('.pb-iv-line');
    if (line) line.textContent = text;
  });
  const actions = doc.createElement('div');
  actions.className = 'pb-iv-acts';
  actions.append(node);
  return { actions, line: state?.lines.get(row.id) };
}

/** Withdraw for the open task while the work is underway; undefined when it does not apply. */
export function renderWithdraw(o: {
  doc: Document;
  row: InboxRowView;
  verdict?: VerdictPort;
  state?: HeldState;
}): HTMLElement | undefined {
  const { doc, row, verdict, state } = o;
  if (!verdict || (row.status !== 'new' && row.status !== 'ack')) return undefined;
  const box = doc.createElement('div');
  box.className = 'pb-it-withdraw';
  const busy = state?.busy.has(row.id) === true;
  const node = button(doc, 'pb-iv-act pb-it-withdraw-btn', 'Withdraw', row.comment, busy);
  const line = doc.createElement('span');
  line.className = 'pb-it-note';
  line.setAttribute('role', 'status');
  line.textContent = state?.lines.get(row.id) ?? '';
  node.addEventListener('click', () => {
    const ok = verdict.withdraw(row.id);
    if (ok) {
      state?.busy.add(row.id);
      busyOn(node);
    }
    line.textContent = ok
      ? 'Withdrawn. The agent is told on its next wait.'
      : 'Could not withdraw. Try again.';
    state?.lines.set(row.id, line.textContent);
  });
  box.append(node, line);
  return box;
}

const hasSite = (doc: Document): boolean =>
  [...doc.querySelectorAll('script[data-passback-endpoint]')].some(
    (s) => (s.getAttribute('data-passback-endpoint') ?? '') !== '',
  );

/** The view's held rows: the Tracker tab, which rows are listed, and Park or Unpark on them. */
export function createHeld(win: Window, doc: Document) {
  const state = createHeldState();
  const tracker = hasSite(doc);
  /** Without the Tracker tab a parked row still lists in All while it can be unparked there. */
  const shelf = (): boolean => tracker || verdictOf(win) !== undefined;
  return {
    state,
    shelf,
    tabs: (['all', ...ORDER] as const).filter((key) => tracker || key !== 'tracker'),
    /** The listed inbox rows with their section and state line; a withdrawn row has none. */
    items: (rows: readonly InboxRowView[]) =>
      rows.flatMap((row) => {
        const section = sectionOf(row);
        const listed = section && (shelf() || section !== 'tracker');
        return listed
          ? [{ section, key: row.id, comment: row.comment, line: stateLine(row), row }]
          : [];
      }),
    /** A snapshot arrived: sends are answered and their lines are stale. */
    settle(): void {
      state.busy.clear();
      state.lines.clear();
    },
    /** What Park or Unpark needs for a Working or Tracker row; none for any other row. */
    args(item: Listed): Options | undefined {
      const { row } = item;
      if (!row || (item.section !== 'working' && item.section !== 'tracker')) return undefined;
      return { doc, row, verdict: verdictOf(win), tracker, busy: state.busy.has(row.id), state };
    },
    /** Puts the held actions in place of the row's Open action, and a failed send's line. */
    put(node: HTMLElement, held: Held | undefined): HTMLElement {
      if (held) node.querySelector('.pb-iv-act')?.replaceWith(held.actions);
      const line = node.querySelector('.pb-iv-line');
      if (held?.line && line) line.textContent = held.line;
      return node;
    },
  };
}
export type HeldView = ReturnType<typeof createHeld>;
