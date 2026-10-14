import type { PinEvent } from './pin';
import { pinTarget, pointOffset } from './pin';

export type PinListenerOptions = {
  doc: Document;
  host: Element;
  dispatch: (event: PinEvent) => void;
};

function stopOutside(event: Event, path: readonly EventTarget[], host: Element): boolean {
  if (path.includes(host)) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

export function listenForPin(opts: PinListenerOptions): () => void {
  const { doc, host, dispatch } = opts;
  let active = true;

  function onPointerMove(event: PointerEvent): void {
    const target = pinTarget(event.composedPath(), host);
    dispatch({ type: 'hover', target });
  }

  function onClick(event: MouseEvent): void {
    const path = event.composedPath();
    if (!stopOutside(event, path, host)) return;
    const target = pinTarget(path, host);
    const offset = target ? pointOffset(target, event.clientX, event.clientY) : { x: 0, y: 0 };
    dispatch({ type: 'pin', target, offset });
  }

  function onSuppress(event: Event): void {
    stopOutside(event, event.composedPath(), host);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dispatch({ type: 'cancel' });
  }

  const listeners: Array<[string, EventListener]> = [
    ['pointermove', onPointerMove as EventListener],
    ['pointerdown', onSuppress],
    ['mousedown', onSuppress],
    ['pointerup', onSuppress],
    ['mouseup', onSuppress],
    ['click', onClick as EventListener],
    ['keydown', onKeyDown as EventListener],
  ];

  for (const [type, listener] of listeners) {
    doc.addEventListener(type, listener, true);
  }

  return () => {
    if (!active) return;
    active = false;
    for (const [type, listener] of listeners) {
      doc.removeEventListener(type, listener, true);
    }
  };
}
