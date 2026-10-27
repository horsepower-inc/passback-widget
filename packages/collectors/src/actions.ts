import { selectorChain } from './selectors';
import type { Entry } from './ring';

export const SCROLL_THROTTLE_MS = 250;

function safeRecord(record: () => void): void {
  try {
    record();
  } catch {
    // swallow: the host's call must still complete
  }
}

function createHistoryWrappers(
  history: History,
  record: () => void,
): { wrappedPushState: History['pushState']; wrappedReplaceState: History['replaceState'] } {
  const callOriginalPushState = history.pushState.bind(history);
  const callOriginalReplaceState = history.replaceState.bind(history);

  const wrappedPushState = function pushState(
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    callOriginalPushState(data, unused, url);
    record();
  } as History['pushState'];

  const wrappedReplaceState = function replaceState(
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    callOriginalReplaceState(data, unused, url);
    record();
  } as History['replaceState'];

  return { wrappedPushState, wrappedReplaceState };
}

export function watchNavigation(win: Window, push: (entry: Entry) => void): () => void {
  const { history } = win;
  const trueOriginalPushState = history.pushState;
  const trueOriginalReplaceState = history.replaceState;
  let lastPath = win.location.pathname;
  let stopped = false;

  function record(): void {
    if (stopped) return;
    const to = win.location.pathname;
    const from = lastPath;
    lastPath = to;
    safeRecord(() => push({ kind: 'navigation', from, to }));
  }

  const { wrappedPushState, wrappedReplaceState } = createHistoryWrappers(history, record);

  history.pushState = wrappedPushState;
  history.replaceState = wrappedReplaceState;

  const onPopState = (): void => record();
  win.addEventListener('popstate', onPopState);

  return () => {
    stopped = true;
    if (history.pushState === wrappedPushState) history.pushState = trueOriginalPushState;
    if (history.replaceState === wrappedReplaceState) {
      history.replaceState = trueOriginalReplaceState;
    }
    win.removeEventListener('popstate', onPopState);
  };
}

// `Element` is a global, not a member of the DOM `Window` type; this reaches it on the given window.
type WindowWithElement = Window & Pick<typeof globalThis, 'Element'>;

function selectorFor(win: Window, target: EventTarget | null): string | undefined {
  if (!(target instanceof (win as WindowWithElement).Element)) return undefined;
  const chain = selectorChain(target);
  // A role selector's name comes from textContent, which can echo what was just typed
  // into a contenteditable element; drop it so only content-free selectors remain.
  const safeChain = (target as HTMLElement).isContentEditable
    ? chain.filter((sel) => sel.kind !== 'role')
    : chain;
  return safeChain[0]?.value;
}

// The widget mounts in a shadow root on the widget host element; a document-level listener
// sees its events retargeted to that host. The literal stays here: collectors must not import widget.
// Some DOMs do not retarget, so the composed path is checked too.
function isInsideWidgetHost(win: Window, event: Event): boolean {
  const { Element } = win as WindowWithElement;
  const inHost = (node: EventTarget | null): boolean =>
    node instanceof Element && node.closest('[data-passback-host]') !== null;
  return inHost(event.target) || event.composedPath().some(inHost);
}

function watchClicksAndInputs(win: Window, push: (entry: Entry) => void): () => void {
  const onClick = (event: MouseEvent): void => {
    safeRecord(() => {
      if (isInsideWidgetHost(win, event)) return;
      const selector = selectorFor(win, event.target);
      push(
        selector === undefined
          ? { kind: 'action', type: 'click' }
          : { kind: 'action', type: 'click', selector },
      );
    });
  };
  const onInput = (event: Event): void => {
    safeRecord(() => {
      if (isInsideWidgetHost(win, event)) return;
      const selector = selectorFor(win, event.target);
      push(
        selector === undefined
          ? { kind: 'action', type: 'input' }
          : { kind: 'action', type: 'input', selector },
      );
    });
  };

  win.document.addEventListener('click', onClick, true);
  win.document.addEventListener('input', onInput, true);

  return () => {
    win.document.removeEventListener('click', onClick, true);
    win.document.removeEventListener('input', onInput, true);
  };
}

function watchScroll(win: Window, push: (entry: Entry) => void, now: () => number): () => void {
  let lastX = win.scrollX;
  let lastY = win.scrollY;
  let lastAt = -Infinity;
  let pendingTimer: ReturnType<typeof win.setTimeout> | undefined;

  function flush(): void {
    pendingTimer = undefined;
    lastAt = now();
    safeRecord(() => {
      const dx = win.scrollX - lastX;
      const dy = win.scrollY - lastY;
      lastX = win.scrollX;
      lastY = win.scrollY;
      push({ kind: 'action', type: 'scroll', delta: [dx, dy] });
    });
  }

  const onScroll = (): void => {
    const elapsed = now() - lastAt;
    if (elapsed >= SCROLL_THROTTLE_MS) {
      if (pendingTimer !== undefined) {
        win.clearTimeout(pendingTimer);
        pendingTimer = undefined;
      }
      flush();
      return;
    }
    // Throttled: keep the most recent scroll, but schedule a trailing flush so
    // it is never dropped if no further scroll event arrives.
    if (pendingTimer === undefined) {
      pendingTimer = win.setTimeout(flush, SCROLL_THROTTLE_MS - elapsed);
    }
  };

  win.addEventListener('scroll', onScroll);
  return () => {
    win.removeEventListener('scroll', onScroll);
    if (pendingTimer !== undefined) win.clearTimeout(pendingTimer);
  };
}

export function watchActions(
  win: Window,
  push: (entry: Entry) => void,
  now: () => number,
): () => void {
  const restoreClicksAndInputs = watchClicksAndInputs(win, push);
  const restoreScroll = watchScroll(win, push, now);

  return () => {
    restoreClicksAndInputs();
    restoreScroll();
  };
}
