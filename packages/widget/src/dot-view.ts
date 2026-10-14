import { type Celebrating, celebrate } from './fx';
import { CLASS } from './styles';

export type DotState =
  | 'pinned'
  | 'sending'
  | 'queued'
  | 'running'
  | 'sent'
  | 'done'
  | 'failed'
  | 'orphaned';

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

const SVG_NS = 'http://www.w3.org/2000/svg';

const CHECK = 'M2.5 6.5l2.5 2.5 4.5-5.5';
const EXCLAMATION ='M6 2.5v4.5M6 9.3v.2';

const PATHS: Readonly<Record<Exclude<DotState, 'pinned'>, string>> = {
  sending: 'M6 1.5a4.5 4.5 0 1 1-4.5 4.5',
  queued: 'M6 1.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9M6 3.5V6l1.8 1.2',
  running: 'M4.2 2.8l5 3.2-5 3.2z',
  sent: CHECK,
  done: CHECK,
  failed: EXCLAMATION,
  orphaned: EXCLAMATION,
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

function symbol(doc: Document, state: string): SVGElement | null {
  const d = (PATHS as Readonly<Record<string, string | undefined>>)[state];
  if (d === undefined) return null;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  if (state === 'running') path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

function render(element: HTMLElement, state: DotState, n: number): void {
  element.setAttribute('data-state', state);
  element.setAttribute('part', `pin pin-${state}`);
  const label = (LABELS as Readonly<Record<string, string | undefined>>)[state];
  if (label === undefined) element.removeAttribute('aria-label');
  else element.setAttribute('aria-label', label);
  if (state === 'pinned') {
    element.replaceChildren(element.ownerDocument.createTextNode(String(n)));
    return;
  }
  const svg = symbol(element.ownerDocument, state);
  if (svg === null) element.replaceChildren();
  else element.replaceChildren(svg);
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
