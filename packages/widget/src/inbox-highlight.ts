export type Highlight = {
  hover(id: string | null): void;
  open(id: string | null): void;
  dispose(): void;
};

/** Tells the target outline which mark to light: the hovered row, else the open task, else none. */
export function createHighlight(host: EventTarget): Highlight {
  let hovered: string | null = null;
  let opened: string | null = null;
  let sent: string | null = null;
  let disposed = false;

  const send = (id: string | null): void => {
    if (id === sent) return;
    sent = id;
    try {
      host.dispatchEvent(new CustomEvent('passback:highlight', { detail: { id } }));
    } catch {
      // The outline is decoration; a throwing listener must not reach the panel.
    }
  };
  const sync = (): void => send(hovered ?? opened);

  return {
    hover(id) {
      if (disposed) return;
      hovered = id;
      sync();
    },
    open(id) {
      if (disposed) return;
      opened = id;
      sync();
    },
    dispose() {
      if (disposed) return;
      send(null);
      disposed = true;
    },
  };
}
