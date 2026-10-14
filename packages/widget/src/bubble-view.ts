import { EMPTY_DRAFT, bubbleKey, draftReducer, readyComment } from './bubble';
import type { Draft } from './bubble';
import {
  buildBar,
  buildPencil,
  renderAcked,
  renderError,
  renderSent,
  renderStatus,
  setDrawing,
} from './bubble-render';
import type { Status } from './bubble-render';
import { dockAbove, undock } from './bubble-dock';
import { placeBeside } from './bubble-place';
import { safePrUrl } from './channel';
import { PRIVACY_URL } from './config';
import { CLASS } from './styles';

export type { Status };

export type Bubble = {
  element: HTMLElement;
  setPending(): void;
  setDrawing(on: boolean): void;
  setKept(n: number): void;
  showAcked(id: string, trimmed: boolean): void;
  showError(message: string, onRetry: () => void): void;
  showSent(): void;
  showStatus(status: Status): void;
  moveTo(anchor: { x: number; y: number }): void;
  showNote(text: string): void;
  destroy(): void;
};

export const DOCK_BELOW = 480;

type Point = { x: number; y: number };

function placeBubble(element: HTMLElement, anchor: Point, docked: boolean, root: ShadowRoot): void {
  if (docked) {
    element.setAttribute('data-docked', '');
    element.style.left = '';
    element.style.top = '';
    dockAbove(element, root);
    return;
  }
  element.removeAttribute('data-docked');
  undock(element, root);
  placeBeside(element, anchor);
}

type Controls = {
  textarea: HTMLTextAreaElement;
  send: HTMLButtonElement;
  keep?: HTMLButtonElement;
};

function buildPrivacy(doc: Document, url: string): HTMLElement {
  const note = doc.createElement('p');
  note.className = CLASS.note;
  const link = doc.createElement('a');
  link.textContent = 'What is sent';
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.color = 'inherit';
  note.appendChild(link);
  return note;
}

function buildBubble(
  doc: Document,
  withKeep: boolean,
  privacyUrl?: string,
  onDiscard?: () => void,
): Controls & { element: HTMLElement; trash?: HTMLButtonElement } {
  const element = doc.createElement('div');
  element.className = CLASS.bubble;
  element.setAttribute('part', 'box');

  const textarea = doc.createElement('textarea');
  textarea.className = CLASS.input;

  const { bar, send, keep, trash } = buildBar(doc, withKeep, onDiscard);
  element.appendChild(textarea);
  element.appendChild(bar);
  if (typeof privacyUrl === 'string') element.appendChild(buildPrivacy(doc, privacyUrl));
  return { element, textarea, send, keep, trash };
}

type Handlers = {
  onSend(comment: string): void;
  onCancel(): void;
  onKeep?(comment: string): void;
  onSendAll?(comment: string): void;
};

function wireInput(
  controls: Controls,
  handlers: Handlers,
  count: () => number,
): void {
  const { textarea, send, keep } = controls;
  let draft: Draft = EMPTY_DRAFT;
  const primary = (comment: string): void => {
    if (count() >= 1 && handlers.onSendAll) handlers.onSendAll(comment);
    else handlers.onSend(comment);
  };

  textarea.addEventListener('input', () => {
    draft = draftReducer(draft, { type: 'text', text: textarea.value });
    send.disabled = readyComment(draft) === null;
    if (keep) keep.disabled = send.disabled;
  });

  textarea.addEventListener('keydown', (event) => {
    const action = bubbleKey(
      { key: event.key, shiftKey: event.shiftKey, isComposing: event.isComposing },
      draft,
    );
    if (action === 'send') {
      event.preventDefault();
      const comment = readyComment(draft);
      if (comment !== null) primary(comment);
    } else if (action === 'cancel') {
      handlers.onCancel();
    }
  });

  send.addEventListener('click', () => {
    const comment = readyComment(draft);
    if (comment !== null) primary(comment);
  });

  keep?.addEventListener('click', () => {
    const comment = readyComment(draft);
    if (comment !== null) handlers.onKeep?.(comment);
  });
}

export type BubbleOptions = {
  anchor: Point;
  onSend(comment: string): void;
  onCancel(): void;
  onDraw?(on: boolean): void;
  onKeep?(comment: string): void;
  onDiscard?(): void;
  onSendAll?(comment: string): void;
  kept?: number;
  viewportWidth?(): number;
  privacyUrl?: string;
};

function makePlacer(
  root: ShadowRoot,
  element: HTMLElement,
  textarea: HTMLTextAreaElement,
  opts: BubbleOptions,
) {
  const doc = element.ownerDocument;
  const width =
    opts.viewportWidth ?? (() => doc.defaultView?.innerWidth ?? Number.POSITIVE_INFINITY);
  let last = opts.anchor;
  return {
    last: (): Point => last,
    place(next: Point, replaced: boolean): void {
      last = next;
      const docked = !replaced && width() < DOCK_BELOW && element.contains(textarea);
      placeBubble(element, last, docked, root);
    },
  };
}

function sentShower(
  doc: Document,
  element: HTMLElement,
  placer: ReturnType<typeof makePlacer>,
): () => void {
  return () => {
    renderSent(doc, element);
    placer.place(placer.last(), true);
  };
}

function makePencil(send: HTMLButtonElement, onDraw: BubbleOptions['onDraw']) {
  const part = (on: boolean): void =>
    pencil?.setAttribute('part', on ? 'pencil pencil-on' : 'pencil');
  const pencil = onDraw
    ? buildPencil(send, (on) => {
        part(on);
        onDraw(on);
      })
    : undefined;
  part(false);
  return {
    pencil,
    setPencil(on: boolean): void {
      setDrawing(pencil, on);
      part(on);
    },
  };
}

function lockControls(
  element: HTMLElement,
  controls: (HTMLButtonElement | HTMLTextAreaElement | undefined)[],
): void {
  element.setAttribute('data-state', 'sending');
  for (const control of controls) if (control) control.disabled = true;
}

function keptLabel(element: HTMLElement, send: HTMLButtonElement, all: boolean, first: number) {
  let kept = 0;
  const setKept = (n: number): void => {
    if (element.hasAttribute('data-state')) return;
    kept = n;
    send.textContent = n >= 1 && all ? 'Send all' : 'Send';
  };
  setKept(first);
  return { setKept, count: () => kept };
}

export function createBubble(root: ShadowRoot, opts: BubbleOptions): Bubble {
  const doc = root.ownerDocument;
  const url = safePrUrl(opts.privacyUrl ?? PRIVACY_URL);
  const built = buildBubble(doc, !!opts.onKeep, url, opts.onDiscard);
  const { element, textarea, send, keep, trash } = built;
  const placer = makePlacer(root, element, textarea, opts);
  const { pencil, setPencil } = makePencil(send, opts.onDraw);
  const { setKept, count } = keptLabel(element, send, !!opts.onSendAll, opts.kept ?? 0);
  wireInput({ textarea, send, keep }, opts, count);
  root.appendChild(element);
  placer.place(opts.anchor, false);
  textarea.focus();
  return {
    element,
    setPending: () => lockControls(element, [textarea, send, keep, trash, pencil]),
    setDrawing: setPencil,
    setKept,
    showAcked(id: string, trimmed: boolean): void {
      element.setAttribute('data-mark-id', id);
      renderAcked(doc, element, trimmed);
      placer.place(placer.last(), true);
    },
    showError(message: string, onRetry: () => void): void {
      renderError(doc, element, message, onRetry);
    },
    showSent: sentShower(doc, element, placer),
    showStatus(status: Status): void {
      renderStatus(doc, element, status);
      element.setAttribute('part', `box box-${status.state}`);
      placer.place(placer.last(), true);
    },
    moveTo(next: { x: number; y: number }): void {
      placer.place(next, false);
    },
    showNote(text: string): void {
      element.querySelector('[data-role="hint"]')?.remove();
      const note = doc.createElement('p');
      note.className = CLASS.note;
      note.setAttribute('data-role', 'hint');
      note.textContent = text;
      element.appendChild(note);
    },
    destroy(): void {
      undock(element, root);
      element.remove();
    },
  };
}
