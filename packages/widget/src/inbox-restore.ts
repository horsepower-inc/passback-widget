import type { ResolveTarget } from '@passback/collectors';
import type { Collector } from './collect';
import type { InboxRowView } from './inbox-sections';
import { createInboxStore, type InboxStore } from './inbox-store';

export type RestoreState = 'queued' | 'running' | 'done' | 'failed';
export type RestorableEntry = {
  id: string;
  n: number;
  target: ResolveTarget;
  state: RestoreState;
  message?: string;
  route?: string;
};
export type RestoreEntry = RestorableEntry & { element: Element };

const STATE_OF: Readonly<Record<string, RestoreState | undefined>> = {
  new: 'queued',
  ack: 'running',
  proposed: 'done',
  verified: 'done',
  declined: 'failed',
};

type Last = { iteration?: { agent?: unknown }; status?: { state?: unknown; message?: unknown } };

function lastOf(row: InboxRowView): Last {
  const iteration: unknown = Array.isArray(row.iterations) ? row.iterations.at(-1) : undefined;
  if (typeof iteration !== 'object' || iteration === null) return {};
  const statuses = (iteration as { statuses?: unknown }).statuses;
  const status: unknown = Array.isArray(statuses) ? statuses.at(-1) : undefined;
  return {
    iteration: iteration as Last['iteration'],
    status: typeof status === 'object' && status !== null ? (status as Last['status']) : undefined,
  };
}

function kindOf(value: string): 'testid' | 'id' | 'role' | 'css' {
  if (value.startsWith('[data-testid=')) return 'testid';
  if (value.startsWith('#') || value.startsWith('[id=')) return 'id';
  if (value.startsWith('role=')) return 'role';
  return 'css';
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

function messageOf(last: Last): string | undefined {
  const agent = last.iteration?.agent;
  return (
    text(last.status?.message) ??
    text(
      typeof agent === 'object' && agent !== null ? (agent as { text?: unknown }).text : undefined,
    )
  );
}

function stateOf(row: InboxRowView, last: Last): RestoreState | undefined {
  const state = STATE_OF[row.status];
  if (row.parked === true || state === undefined) return undefined;
  return last.status?.state === 'failed' ? 'failed' : state;
}

/** One entry per inbox row that can have a mark on the page. */
export function restorableOf(store: Pick<InboxStore, 'rows' | 'numberOf'>): RestorableEntry[] {
  const entries: RestorableEntry[] = [];
  for (const row of store.rows()) {
    const last = lastOf(row);
    const state = stateOf(row, last);
    const n = store.numberOf(row.id);
    if (state === undefined || n === undefined || !row.target) continue;
    const selector = (row as { selector?: unknown }).selector;
    if (typeof selector !== 'string' || selector === '') continue;
    const message = messageOf(last);
    const route = text((row as { route?: unknown }).route);
    entries.push({
      id: row.id,
      n,
      state,
      target: {
        selectors: [{ kind: kindOf(selector), value: selector }],
        tag: row.target.tag,
        text: row.target.text,
      } as ResolveTarget,
      ...(message === undefined ? {} : { message }),
      ...(route === undefined ? {} : { route }),
    });
  }
  return entries;
}

/** After a route change the router needs this long to render the new page. */
export const ROUTE_SETTLE_MS = 300;

export type WatchInbox = {
  win: Window;
  ensureCollector(): Promise<Collector>;
  restore(entries: RestoreEntry[]): void;
};

function resolveHere(collector: Collector, doc: Document, entries: RestorableEntry[]) {
  const found: RestoreEntry[] = [];
  const here = collector.route?.();
  for (const entry of entries) {
    if (entry.route !== undefined && here !== undefined && entry.route !== here) continue;
    const hit = collector.reresolve(doc, entry.target);
    if (hit) found.push({ ...entry, element: hit.element });
  }
  return found;
}

/** Brings back the marks of the inbox rows after a load; returns the stop function. */
export function watchInbox({ win, ensureCollector, restore }: WatchInbox): () => void {
  const store = createInboxStore(win);
  let restored = false;
  let latest = 0;
  let stopped = false;
  let subscribed = false;
  let offRoute: (() => void) | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;
  const onRoute = (): void => {
    if (stopped) return;
    void run();
    clearTimeout(settle);
    settle = setTimeout(() => void run(), ROUTE_SETTLE_MS);
  };
  const run = async (): Promise<void> => {
    const mine = ++latest;
    try {
      const entries = restorableOf(store);
      if (entries.length === 0 && !restored) return;
      const collector = await ensureCollector();
      if (stopped) return;
      if (!subscribed) {
        subscribed = true;
        try {
          offRoute = collector.onRoute?.(onRoute);
        } catch {
          // Marks then follow the next snapshot.
        }
      }
      if (mine !== latest) return;
      const found = resolveHere(collector, win.document, entries);
      if (found.length === 0 && !restored) return;
      restored = true;
      restore(found);
    } catch {
      // The page keeps working without restored marks.
    }
  };
  const off = store.subscribe(() => void run());
  return () => {
    stopped = true;
    clearTimeout(settle);
    offRoute?.();
    off();
    store.dispose();
  };
}
