import type { TimelineEvent } from '@passback/schema';

export const WINDOW_MS = 30_000;
export const MAX_ENTRIES = 200;

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export type Entry = DistributiveOmit<TimelineEvent, 't'>;

interface Stored {
  entry: Entry;
  at: number;
}

export function createRing(now: () => number): {
  push(entry: Entry): void;
  snapshot(): TimelineEvent[];
} {
  let items: Stored[] = [];

  function prune(): void {
    const cutoff = now() - WINDOW_MS;
    items = items.filter((item) => item.at >= cutoff);
    if (items.length > MAX_ENTRIES) {
      items = items.slice(items.length - MAX_ENTRIES);
    }
  }

  return {
    push(entry: Entry): void {
      items.push({ entry, at: now() });
      prune();
    },
    snapshot(): TimelineEvent[] {
      prune();
      return items.map(
        ({ entry, at }) => ({ ...entry, t: Math.round(at - now()) }) as TimelineEvent,
      );
    },
  };
}
