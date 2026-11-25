import { type Celebrating, celebrate } from './fx';
import { CLASS, FRAME_ATTRIBUTE, frameRule } from './styles';

export type DotState =
  | 'pinned'
  | 'sending'
  | 'queued'
  | 'running'
  | 'sent'
  | 'done'
  | 'failed'
  | 'question'
  | 'orphaned';

export type Dot = {
  element: HTMLElement;
  setState(state: DotState): void;
  setNumber(n: number): void;
  moveTo(point: { x: number; y: number }): void;
  remove(): void;
};

export type Outline = {
  show(el: Element | null): void;
  destroy(): void;
};

const LABELS: Readonly<Record<DotState, string>> = {
  pinned: 'Not sent yet',
  sending: 'Sending',
  queued: 'Waiting',
  running: 'Agent working',
  sent: 'Sent',
  done: 'Fixed',
  failed: 'Failed',
  question: 'The agent has a question',
  orphaned: 'The marked element is gone',
};

function render(element: HTMLElement, state: DotState, n: number): void {
  element.setAttribute('data-state', state);
  element.setAttribute('part', `pin pin-${state}`);
  const label = (LABELS as Readonly<Record<string, string | undefined>>)[state];
  if (label === undefined) element.removeAttribute('aria-label');
  else element.setAttribute('aria-label', label);
  element.replaceChildren(element.ownerDocument.createTextNode(String(n)));
}

export function createDot(
  root: ShadowRoot,
  point: { x: number; y: number },
  first = 1,
  initial: DotState = 'pinned',
): Dot {
  const doc = root.ownerDocument;
  let n = first;
  const element = doc.createElement('div');
  element.className = CLASS.dot;
  element.setAttribute('role', 'img');
  render(element, initial, n);
  element.style.left = `${point.x}px`;
  element.style.top = `${point.y}px`;
  root.appendChild(element);

  let at = point;
  let stamp: Celebrating | null = null;

  return {
    element,
    setState(state: DotState): void {
      const before = element.getAttribute('data-state');
      render(element, state, n);
      if (state !== before) {
        stamp?.remove();
        stamp = state === 'sent' || state === 'done' ? celebrate(root, element, state, at) : null;
      }
    },
    setNumber(next: number): void {
      n = next;
      render(element, element.getAttribute('data-state') as DotState, n);
    },
    moveTo(next: { x: number; y: number }): void {
      at = next;
      element.style.left = `${next.x}px`;
      element.style.top = `${next.y}px`;
      stamp?.move(next);
    },
    remove(): void {
      stamp?.remove();
      stamp = null;
      element.remove();
    },
  };
}

export function createOutline(root: ShadowRoot): Outline {
  const doc = root.ownerDocument;
  const element = doc.createElement('div');
  element.className = CLASS.outline;
  element.hidden = true;
  root.appendChild(element);
  const hint = doc.createElement('div');
  hint.className = CLASS.hint;
  hint.setAttribute('role', 'status');
  hint.setAttribute('part', 'hint');
  hint.setAttribute(
    'data-corner',
    root.querySelector('.pb-launcher')?.getAttribute('data-corner') ?? 'bottom-right',
  );
  const long = doc.createElement('span');
  long.setAttribute('data-long', '');
  long.textContent = 'Click anything to comment · ';
  hint.append(long, 'Esc to leave');
  root.appendChild(hint);
  const notch = keptPill(root, hint);

  return {
    show(el: Element | null): void {
      if (el === null) {
        element.hidden = true;
        return;
      }
      const rect = el.getBoundingClientRect();
      element.style.left = `${rect.left}px`;
      element.style.top = `${rect.top}px`;
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
      element.hidden = false;
    },
    destroy(): void {
      notch.stop();
      element.remove();
      hint.remove();
    },
  };
}

// The number the send-all add-on says one click sends; zero when the add-on is not loaded.
function batchSize(host: Element): number {
  const detail = { n: 0 };
  host.dispatchEvent(new CustomEvent('passback:batch-size', { detail }));
  return detail.n;
}

/**
 * Send all in the armed notch for kept comments. The pill rides 's drawing-notch rule, which
 * keys on `data-draw`, so the hint carries it only while the pill exists; a drawing hint beside it
 * takes the pill away and hides this hint until the drawing ends.
 */
function keptPill(root: ShadowRoot, hint: HTMLElement): { stop(): void } {
  const doc = root.ownerDocument;
  const host = root.host;
  let pill: HTMLButtonElement | undefined;
  let hiddenByUs = false;
  const click = (): void => void host.dispatchEvent(new Event('passback:send-all'));
  const drop = (): void => {
    pill?.removeEventListener('click', click);
    pill?.remove();
    pill = undefined;
    hint.removeAttribute('data-draw');
  };
  const refresh = (): void => {
    const drawing = [...root.querySelectorAll(`.${CLASS.hint}[data-draw]`)].some((h) => h !== hint);
    if (drawing) {
      drop();
      if (!hint.hidden) hint.hidden = hiddenByUs = true;
      return;
    }
    if (hiddenByUs) hint.hidden = hiddenByUs = false;
    const n = batchSize(host);
    if (n === 0) return drop();
    if (!pill) {
      pill = doc.createElement('button');
      pill.type = 'button';
      pill.dataset.act = 'send';
      pill.setAttribute('part', 'tool tool-send');
      pill.append(doc.createElement('span'), doc.createElement('span'));
      pill.firstElementChild!.textContent = 'Send all';
      pill.lastElementChild!.setAttribute('data-count', '');
      pill.addEventListener('click', click);
      hint.setAttribute('data-draw', '');
      hint.append(pill);
    }
    pill.lastElementChild!.textContent = String(n);
  };
  const watch = new MutationObserver(refresh);
  watch.observe(root, { childList: true });
  host.addEventListener('passback:sync', refresh);
  refresh();
  return {
    stop(): void {
      watch.disconnect();
      host.removeEventListener('passback:sync', refresh);
      drop();
    },
  };
}

// Each host's own frame, by identity: a page element carrying the same attribute is not the widget's.
// Kept on the host under a registry symbol, not in module state, because the shot chunk is a
// separate bundle with its own copy of this module.
const FRAME_KEY = Symbol.for('passback.frame');
type FrameHost = Element & { [FRAME_KEY]?: HTMLElement };

/** The frame this widget host mounted, so the picture can leave out exactly it and nothing of the page. */
export function pageFrameOf(host: Element): HTMLElement | undefined {
  return (host as FrameHost)[FRAME_KEY];
}

/** The page frame; the overlay owns it so it outlives the outline across armed, composing and drawing. */
export function mountFrame(root: ShadowRoot): HTMLElement {
  const doc = root.ownerDocument;
  const style = root.host.isConnected ? doc.defaultView?.getComputedStyle(root.host) : undefined;
  const token = (name: string, fallback: string): string =>
    style?.getPropertyValue(name).trim() || fallback;
  const frame = doc.createElement('div');
  frame.setAttribute(FRAME_ATTRIBUTE, '');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = frameRule(
    token('--pb-color-main', '#17181c'),
    token('--pb-z', '2147483647'),
  );
  // Before <body> in tree order, so at the widget's own z-index it paints under the widget's controls.
  doc.documentElement.insertBefore(frame, doc.body);
  (root.host as FrameHost)[FRAME_KEY] = frame;
  return frame;
}

let rememberedCursor: string | null = null;

export function setCrosshair(doc: Document, on: boolean): void {
  if (on) {
    if (rememberedCursor === null) {
      rememberedCursor = doc.documentElement.style.cursor;
    }
    doc.documentElement.style.cursor = 'crosshair';
    return;
  }
  if (rememberedCursor !== null) {
    doc.documentElement.style.cursor = rememberedCursor;
    rememberedCursor = null;
  }
}
