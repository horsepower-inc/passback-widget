import { agentLine } from './agent-line';
import { createBoundary } from './boundary';
import { createInboxFeed, type InboxFeed } from './inbox-feed';
import { mountInboxMenu } from './inbox-menu';
import { mountInboxView } from './inbox-view';

// The local Inbox panel shell, built as its own chunk (dist/passback-panel.js) and opened on demand.
export type InboxPanelOptions = {
  root: ShadowRoot;
  win: Window;
  anchor: Element;
  onClose?: () => void;
  onMenu?: () => void;
  onOpen?: (id: string) => void;
};
export type InboxPanelSession = {
  element: HTMLElement;
  content: HTMLElement;
  close(): void;
  setAgent(raw: unknown): void;
};
export type InboxPanelOpen = (opts: InboxPanelOptions) => InboxPanelSession | undefined;

// The panel width is a constant of this chunk, not a shared token.
const PANEL_WIDTH = '420px';
const STYLE = 'data-pb-inbox-style';

function rules(): string {
  return `.pb-inbox {
  position: fixed;
  z-index: var(--pb-z);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(${PANEL_WIDTH}, calc(100vw - 2 * var(--pb-space-gap)));
  background: var(--pb-color-surface);
  color: var(--pb-color-text);
  border: thin solid var(--pb-color-border);
  border-radius: var(--pb-radius-box);
  box-shadow: var(--pb-shadow-box);
  font: var(--pb-font-body);
  pointer-events: auto;
}

.pb-inbox-head {
  display: flex;
  align-items: center;
  gap: var(--pb-space-gap);
  padding: var(--pb-space-pad);
  border-bottom: thin solid var(--pb-color-border);
}

.pb-inbox-title {
  flex: 1;
  margin: 0;
  font: inherit;
  font-weight: 600;
}

.pb-inbox-head button {
  border: thin solid var(--pb-color-border);
  border-radius: var(--pb-radius-control);
  background: transparent;
  color: var(--pb-color-text);
  font: inherit;
  cursor: pointer;
}

.pb-inbox-content {
  padding: var(--pb-space-pad);
}

.pb-inbox-agent {
  padding: var(--pb-space-gap);
  color: var(--pb-color-text-muted);
  font: var(--pb-font-small);
}

.pb-inbox-agent::before {
  content: '●';
  margin-right: var(--pb-space-gap);
  color: var(--pb-color-text-muted);
}

.pb-inbox-agent[data-state='waiting']::before {
  color: var(--pb-color-ok);
}

.pb-inbox-agent[data-state='working']::before {
  color: var(--pb-color-accent);
}`;
}

function headerButton(doc: Document, label: string, name: string): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', name);
  return button;
}

type Parts = {
  style: HTMLStyleElement;
  card: HTMLElement;
  menu: HTMLButtonElement;
  shut: HTMLButtonElement;
  content: HTMLElement;
};

function build(doc: Document): Parts {
  const style = doc.createElement('style');
  style.setAttribute(STYLE, '');
  style.textContent = rules();
  const card = doc.createElement('section');
  card.className = 'pb-inbox';
  card.setAttribute('role', 'region');
  card.setAttribute('aria-label', 'Inbox');
  card.style.pointerEvents = 'auto';
  const head = doc.createElement('header');
  head.className = 'pb-inbox-head';
  const title = doc.createElement('h2');
  title.className = 'pb-inbox-title';
  title.textContent = 'Inbox';
  const menu = headerButton(doc, '⋯', 'Inbox menu');
  const shut = headerButton(doc, '✕', 'Close Inbox');
  head.append(title, menu, shut);
  const content = doc.createElement('div');
  content.className = 'pb-inbox-content';
  card.append(head, content);
  return { style, card, menu, shut, content };
}

// Measured once on open: above the anchor, one gap apart, right edges aligned.
function place(card: HTMLElement, win: Window, anchor: Element): void {
  const rect = anchor.getBoundingClientRect();
  card.style.position = 'fixed';
  card.style.bottom = `calc(${win.innerHeight - rect.top}px + var(--pb-space-gap))`;
  card.style.right = `${win.innerWidth - rect.right}px`;
}

export const openInboxPanel: InboxPanelOpen = (opts) => {
  const { root, win, anchor, onClose, onMenu, onOpen } = opts;
  let parts: Parts | undefined;
  let closed = false;
  let unmountView: (() => void) | undefined;
  let unmountMenu: (() => void) | undefined;
  let feed: InboxFeed | undefined;
  const listeners: [HTMLButtonElement, () => void][] = [];
  const teardown = (): void => {
    closed = true;
    unmountMenu?.();
    unmountView?.();
    feed?.dispose();
    for (const [button, listener] of listeners) button.removeEventListener('click', listener);
    listeners.length = 0;
    parts?.card.remove();
    parts?.style.remove();
  };
  const boundary = createBoundary(teardown);
  const listen = (button: HTMLButtonElement, fn: () => void): void => {
    const listener = boundary.guard(fn) as () => void;
    listeners.push([button, listener]);
    button.addEventListener('click', listener);
  };
  let agent: HTMLElement | undefined;
  const setAgent = boundary.guard((raw: unknown): void => {
    if (closed || !parts) return;
    const next = agentLine(raw);
    if (!next) {
      agent?.remove();
      agent = undefined;
      return;
    }
    if (!agent) {
      agent = parts.card.ownerDocument.createElement('div');
      agent.className = 'pb-inbox-agent';
      agent.setAttribute('role', 'status');
      agent.setAttribute('aria-live', 'polite');
      parts.card.firstElementChild?.after(agent);
    }
    agent.setAttribute('data-state', next.state);
    agent.textContent = next.text;
  });
  const session = boundary.guard((): InboxPanelSession => {
    parts = build(root.ownerDocument);
    root.append(parts.style, parts.card);
    listen(parts.menu, () => onMenu?.());
    listen(parts.shut, () => {
      if (closed) return;
      teardown();
      onClose?.();
    });
    place(parts.card, win, anchor);
    const { card, content } = parts;
    unmountView = mountInboxView({ content, host: root.host, win, onOpen });
    unmountMenu = mountInboxMenu({ card, button: parts.menu, win });
    const shown = (): void => void setAgent(feed?.agent());
    feed = createInboxFeed(win, shown);
    shown();
    return {
      element: card,
      content,
      setAgent: (raw) => void setAgent(raw),
      close: () => {
        if (!closed) teardown();
      },
    };
  })();
  return boundary.tripped() ? undefined : session;
};

// Evaluating the chunk registers the opener without mounting anything.
const scope = globalThis as { __passback?: Record<string, unknown> };
scope.__passback = Object.assign(scope.__passback ?? {}, { panel: openInboxPanel });
