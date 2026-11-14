import type { TimelineEvent } from '@passback/schema';
import { watchActions, watchNavigation } from './actions';
import { watchConsole } from './console';
import { watchNetwork } from './network';
import { createRing, type Entry } from './ring';

export interface TimelineHandle {
  snapshot(): TimelineEvent[];
  stop(): void;
}

export function startTimeline(
  win: Window,
  now: () => number = () => win.performance.now(),
): TimelineHandle {
  const ring = createRing(now);
  const push = (entry: Entry): void => {
    try {
      ring.push(entry);
    } catch {
      // swallow: an exception in any recording path must not reach the host
    }
  };

  const restoreConsole = watchConsole(win, push);
  const restoreNavigation = watchNavigation(win, push);
  const restoreActions = watchActions(win, push, now);
  const restoreNetwork = watchNetwork(win, push, now);

  let stopped = false;
  return {
    snapshot: () => ring.snapshot(),
    stop: () => {
      if (stopped) return;
      stopped = true;
      restoreConsole();
      restoreNavigation();
      restoreActions();
      restoreNetwork();
    },
  };
}
