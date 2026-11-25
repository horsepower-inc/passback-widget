import { createInboxFeed } from './inbox-feed';
import { sectionOf, type InboxRowView, type Section } from './inbox-sections';

export type InboxStore = {
  rows(): readonly InboxRowView[];
  truncated(): boolean;
  loaded(): boolean;
  agent(): unknown;
  /** The 1-based position of an inbox row in the panel list (Needs you, Working, Fixed). */
  numberOf(id: string): number | undefined;
  subscribe(cb: () => void): () => void;
  dispose(): void;
};

type Scope = { __passback?: { inbox?: InboxStore } & Record<string, unknown> };

const NUMBERED: readonly Section[] = ['needs', 'working', 'fixed'];

/** Ids in list order; sections in NUMBERED order, the snapshot order inside a section. */
function sequenceOf(rows: readonly InboxRowView[]): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const section of NUMBERED) {
    for (const row of rows) {
      if (sectionOf(row) === section && !numbers.has(row.id)) numbers.set(row.id, numbers.size + 1);
    }
  }
  return numbers;
}

/** The one widget-side subscription to `passback:items`; the restore and the panel both read it. */
export function createInboxStore(win: Window): InboxStore {
  const subscribers = new Set<() => void>();
  let numbers: Map<string, number> | null = null;
  const notify = (): void => {
    numbers = null;
    for (const cb of [...subscribers]) {
      try {
        cb();
      } catch {
        // One broken subscriber never stops the others.
      }
    }
  };
  const feed = createInboxFeed(win, notify);
  const store: InboxStore = {
    rows: () => feed.rows(),
    truncated: () => feed.truncated(),
    loaded: () => feed.loaded(),
    agent: () => feed.agent(),
    numberOf(id) {
      numbers ??= sequenceOf(feed.rows());
      return numbers.get(id);
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => void subscribers.delete(cb);
    },
    dispose() {
      feed.dispose();
      subscribers.clear();
      try {
        const bag = (win as unknown as Scope).__passback;
        if (bag?.inbox === store) delete bag.inbox;
      } catch {
        // Nothing to unpublish.
      }
    },
  };
  try {
    const bag = (win as unknown as Scope).__passback;
    if (bag) bag.inbox = store;
  } catch {
    // The store works without being published.
  }
  return store;
}
