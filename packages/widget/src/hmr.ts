import { reattachMarks, type OpenMark, type Reattached } from './reattach';
import { captureView, restoreView, type ViewRestore, type ViewSnapshot } from './view-state';

export type Hot = {
  on(event: string, cb: (payload?: unknown) => void): void;
  off?(event: string, cb: (payload?: unknown) => void): void;
};

export type WatchHmrOptions<M extends OpenMark> = {
  hot: Hot | undefined;
  win: Pick<Window, 'location' | 'scrollX' | 'scrollY' | 'scrollTo'>;
  marks(): readonly M[];
  resolve(mark: M): Element | null;
  onRestored(results: Reattached<M>[], view: ViewRestore): void;
  defer?: (run: () => void) => void;
};

function defaultDefer(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(run);
  } else {
    queueMicrotask(run);
  }
}

export function watchHmr<M extends OpenMark>(opts: WatchHmrOptions<M>): () => void {
  const { hot, win, marks, resolve, onRestored } = opts;
  const defer = opts.defer ?? defaultDefer;

  if (!hot) return () => {};

  let snapshot: ViewSnapshot | null = null;
  let active = true;

  function onBeforeUpdate(): void {
    try {
      snapshot = captureView(win);
    } catch {
      // the overlay never throws into the host page
    }
  }

  function onAfterUpdate(): void {
    if (!snapshot) return;
    const taken = snapshot;
    snapshot = null;
    try {
      defer(() => {
        if (!active) return;
        try {
          const results = reattachMarks(marks(), resolve);
          const view = restoreView(win, taken);
          onRestored(results, view);
        } catch {
          // the overlay never throws into the host page
        }
      });
    } catch {
      // the overlay never throws into the host page
    }
  }

  hot.on('vite:beforeUpdate', onBeforeUpdate);
  hot.on('vite:afterUpdate', onAfterUpdate);

  return () => {
    if (!active) return;
    active = false;
    hot.off?.('vite:beforeUpdate', onBeforeUpdate);
    hot.off?.('vite:afterUpdate', onAfterUpdate);
  };
}
