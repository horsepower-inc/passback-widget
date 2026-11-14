import type { Hot } from './channel';
import type { Launcher } from './launcher';

type ConnectionCtx = { root: ShadowRoot; host: HTMLElement; launcher: Launcher };

const RULES = `
.pb-offline-badge { position: absolute; top: 0; right: 0; width: 10px; height: 10px; box-sizing: border-box; border: 2px solid var(--pb-color-surface); border-radius: 50%; background: var(--pb-color-bad); pointer-events: none; }
`;
const LABEL = 'Passback: dev server offline';
const LINE = 'Dev server offline: reconnect to send';
const SENDS = '[data-role="send"], .pb-tray .pb-send';
const DOWN = 'vite:ws:disconnect';
const UP = 'vite:ws:connect';

function addLine(doc: Document, bubble: Element): void {
  if (bubble.querySelector('[data-pb-offline-line]')) return;
  const note = doc.createElement('p');
  note.className = 'pb-note';
  note.setAttribute('data-role', 'hint');
  note.setAttribute('data-pb-offline-line', '');
  note.textContent = LINE;
  bubble.append(note);
}

type View = {
  isOffline(): boolean;
  show(): void;
  sync(): void;
  resync(bubble: Element): void;
  relabel(): void;
  clear(): void;
  remove(): void;
};

type Sends = { hold(): void; rehold(bubble: Element): void; release(): void };

function createSends(root: ShadowRoot): Sends {
  // Each Send the add-on disabled, with the disabled state the widget wants for it.
  const disabled = new Map<HTMLButtonElement, boolean>();
  const hold = (): void => {
    for (const send of root.querySelectorAll<HTMLButtonElement>(SENDS)) {
      if (disabled.has(send)) continue;
      disabled.set(send, send.disabled);
      send.disabled = true;
    }
  };
  // The bubble's input handler rewrote its Send: take that as the wanted state and disable again.
  const rehold = (bubble: Element): void => {
    bubble.querySelectorAll<HTMLButtonElement>(SENDS).forEach((send) => disabled.delete(send));
    hold();
  };
  const release = (): void => {
    for (const [send, wanted] of disabled) send.disabled = wanted;
    disabled.clear();
  };
  return { hold, rehold, release };
}

function createBadge(root: ShadowRoot): { style: HTMLStyleElement; badge: HTMLSpanElement } {
  const doc = root.ownerDocument;
  const style = doc.createElement('style');
  style.setAttribute('data-pb-connection-styles', '');
  style.textContent = RULES;
  root.append(style);
  const badge = doc.createElement('span');
  badge.className = 'pb-offline-badge';
  badge.setAttribute('part', 'offline-badge');
  return { style, badge };
}

function createView({ root, host, launcher }: ConnectionCtx): View {
  const doc = root.ownerDocument;
  const ball = launcher.element;
  const { style, badge } = createBadge(root);
  const sends = createSends(root);
  let label = '';
  let offline = false;

  const sync = (): void => {
    if (!offline) return;
    sends.hold();
    root.querySelectorAll('.pb-bubble').forEach((bubble) => addLine(doc, bubble));
  };
  const resync = (bubble: Element): void => {
    if (offline) sends.rehold(bubble);
  };
  const relabel = (): void => {
    const now = ball.getAttribute('aria-label') ?? '';
    if (!offline || now === LABEL) return;
    label = now;
    ball.setAttribute('aria-label', LABEL);
  };
  const clear = (): void => {
    if (!offline) return;
    offline = false;
    host.removeAttribute('data-pb-connection');
    badge.remove();
    ball.setAttribute('aria-label', label);
    sends.release();
    root.querySelectorAll('[data-pb-offline-line]').forEach((line) => line.remove());
  };
  const show = (): void => {
    if (offline) return;
    offline = true;
    host.setAttribute('data-pb-connection', 'offline');
    ball.append(badge);
    relabel();
    sync();
  };
  return {
    isOffline: () => offline,
    show,
    sync,
    resync,
    relabel,
    clear,
    remove: () => (clear(), style.remove()),
  };
}

/** Collector-chunk add-on: in local mode shows on the host, the ball and Send that the dev server connection is lost. */
export function connection(ctx: ConnectionCtx): void {
  const { root, host, launcher } = ctx;
  const hot = (root.ownerDocument.defaultView as { __passback?: { hot?: Hot } } | null)?.__passback
    ?.hot;
  if (!hot) return;
  const view = createView(ctx);
  let disposed = false;
  const down = (): void => void (disposed || view.show());
  const up = (): void => void (disposed || view.clear());
  const watchLabel = new MutationObserver(() => view.relabel());
  const watchRoot = new MutationObserver(() => view.sync());
  const bubbleOf = (event: Event): Element | null =>
    event.target instanceof Element ? event.target.closest('.pb-bubble') : null;
  const onInput = (event: Event): void => {
    const bubble = bubbleOf(event);
    if (!disposed && view.isOffline() && bubble) view.resync(bubble);
  };
  // Capture phase on the root runs before the comment's own Enter handler, which sends without checking Send.
  // Only the comment textarea's send shortcut is held: Enter on the bubble's buttons and links still works.
  const onKey = (event: Event): void => {
    if (disposed || !view.isOffline() || !bubbleOf(event)) return;
    if ((event.target as Element).tagName !== 'TEXTAREA') return;
    const key = event as KeyboardEvent;
    if (key.key !== 'Enter' || key.shiftKey || key.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const dispose = (): void => {
    disposed = true;
    watchLabel.disconnect();
    watchRoot.disconnect();
    root.removeEventListener('input', onInput);
    root.removeEventListener('keydown', onKey, true);
    hot.off?.(DOWN, down);
    hot.off?.(UP, up);
    host.removeEventListener('passback:dispose', dispose);
    view.remove();
  };
  watchLabel.observe(launcher.element, { attributes: true, attributeFilter: ['aria-label'] });
  watchRoot.observe(root, { childList: true, subtree: true });
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKey, true);
  hot.on(DOWN, down);
  hot.on(UP, up);
  host.addEventListener('passback:dispose', dispose);
}
