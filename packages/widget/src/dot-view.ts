import { type Celebrating, celebrate } from './fx';
import { CLASS } from './styles';

export type DotState =
  'pinned' | 'sending' | 'queued' | 'running' | 'sent' | 'done' | 'failed' | 'orphaned';

export type Dot = {
  element: HTMLElement;
  setState(state: DotState): void;
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

export function createDot(root: ShadowRoot, point: { x: number; y: number }, n = 1): Dot {
  const doc = root.ownerDocument;
  const element = doc.createElement('div');
  element.className = CLASS.dot;
  element.setAttribute('role', 'img');
  render(element, 'pinned', n);
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
  hint.textContent = 'Click anything to comment · Esc to leave';
  root.appendChild(hint);

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
      element.remove();
      hint.remove();
    },
  };
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
