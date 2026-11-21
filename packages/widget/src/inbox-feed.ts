import type { Hot } from './channel';
import type { InboxRowView } from './inbox-sections';

export type InboxFeed = {
  rows(): readonly InboxRowView[];
  truncated(): boolean;
  loaded(): boolean;
  agent(): unknown;
  dispose(): void;
};

/** What the window inbox store offers the feed; the store's own type lives in inbox-store.ts. */
type InboxStore = Omit<InboxFeed, 'agent'> & {
  agent?(): unknown;
  subscribe(cb: () => void): () => void;
};

type Scope = { __passback?: { hot?: Partial<Hot>; caps?: unknown; inbox?: InboxStore } };

const text = (value: unknown): boolean => typeof value === 'string';
const isItem = (item: unknown): item is InboxRowView => {
  const row = item as Partial<Record<keyof InboxRowView, unknown>> | null;
  return (
    typeof row === 'object' &&
    row !== null &&
    text(row.id) &&
    text(row.status) &&
    text(row.comment) &&
    Array.isArray(row.iterations)
  );
};

function storeOf(win: Window): InboxStore | undefined {
  try {
    return (win as unknown as Scope).__passback?.inbox;
  } catch {
    return undefined;
  }
}

/** Reads the inbox rows the dev server pushes on `passback:items`; never throws. */
export function createInboxFeed(win: Window, onChange: () => void): InboxFeed {
  const store = storeOf(win);
  if (store) {
    const off = store.subscribe(onChange);
    return {
      rows: () => store.rows(),
      truncated: () => store.truncated(),
      loaded: () => store.loaded(),
      agent: () => (typeof store.agent === 'function' ? store.agent() : undefined),
      dispose: off,
    };
  }
  let rows: readonly InboxRowView[] = [];
  let truncated = false;
  let loaded = false;
  let agent: unknown;
  let disposed = false;
  let off: (() => void) | undefined;
  const handler = (data: unknown): void => {
    try {
      const msg = data as {
        v?: unknown;
        items?: unknown;
        agent?: unknown;
        truncated?: unknown;
      } | null;
      if (disposed || !msg || msg.v !== 1 || !Array.isArray(msg.items)) return;
      rows = msg.items.filter(isItem);
      truncated = msg.truncated === true;
      agent = msg.agent;
      loaded = true;
      onChange();
    } catch {
      // A broken subscriber never reaches the host page.
    }
  };
  try {
    const bag = (win as unknown as Scope).__passback;
    const hot = bag?.hot;
    if (hot?.on && hot.send && Array.isArray(bag?.caps) && bag.caps.includes('list')) {
      hot.on('passback:items', handler);
      off = () => hot.off?.('passback:items', handler);
      hot.send('passback:list', { v: 1 });
    }
  } catch {
    // No channel: the feed stays empty.
  }
  return {
    rows: () => rows,
    truncated: () => truncated,
    loaded: () => loaded,
    agent: () => agent,
    dispose() {
      disposed = true;
      try {
        off?.();
      } catch {
        // Nothing to undo.
      }
    },
  };
}
