import type { InboxPanelOpen } from './inbox-panel';

export type { InboxPanelOpen, InboxPanelOptions, InboxPanelSession } from './inbox-panel';

type WithPanel = { __passback?: { panel?: unknown } };
const loads = new WeakMap<Document, Promise<InboxPanelOpen>>();

function registered(win: Window): InboxPanelOpen | undefined {
  const panel = (win as unknown as WithPanel).__passback?.panel;
  return typeof panel === 'function' ? (panel as InboxPanelOpen) : undefined;
}

// The caller names the chunk URL; one pending load per document, evicted when it fails.
export function loadPanelOpen(doc: Document, win: Window, src: string): Promise<InboxPanelOpen> {
  const ready = registered(win);
  if (ready) return Promise.resolve(ready);
  const pending = loads.get(doc);
  if (pending) return pending;
  if (!src) return Promise.reject(new Error('passback: no URL for the panel chunk'));
  const load = new Promise<InboxPanelOpen>((resolve, reject) => {
    const script = doc.createElement('script');
    script.async = true;
    script.src = src;
    script.addEventListener('load', () => {
      const open = registered(win);
      if (open) resolve(open);
      else reject(new Error('passback: the panel chunk loaded but registered nothing'));
    });
    script.addEventListener('error', () => {
      reject(new Error(`passback: cannot load the panel chunk (${src})`));
    });
    doc.head.appendChild(script);
  });
  loads.set(doc, load);
  load.catch(() => {
    if (loads.get(doc) === load) loads.delete(doc);
  });
  return load;
}
