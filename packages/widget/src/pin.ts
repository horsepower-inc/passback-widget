import type { Offset } from '@passback/schema';

export type PinState =
  | { phase: 'idle' }
  | { phase: 'armed'; hovered: Element | null }
  | { phase: 'pinned'; element: Element; offset: Offset };

export type PinEvent =
  | { type: 'arm' }
  | { type: 'hover'; target: Element | null }
  | { type: 'pin'; target: Element | null; offset: Offset }
  | { type: 'cancel' };

export const IDLE: PinState = { phase: 'idle' };

function arm(state: PinState): PinState {
  if (state.phase === 'armed') return state;
  return { phase: 'armed', hovered: null };
}

function hover(state: PinState, target: Element | null): PinState {
  if (state.phase !== 'armed') return state;
  return { phase: 'armed', hovered: target };
}

function pin(state: PinState, target: Element | null, offset: Offset): PinState {
  if (state.phase !== 'armed' || target === null) return state;
  return { phase: 'pinned', element: target, offset };
}

function cancel(state: PinState): PinState {
  if (state.phase === 'idle') return state;
  return IDLE;
}

export function pinReducer(state: PinState, event: PinEvent): PinState {
  switch (event.type) {
    case 'arm':
      return arm(state);
    case 'hover':
      return hover(state, event.target);
    case 'pin':
      return pin(state, event.target, event.offset);
    case 'cancel':
      return cancel(state);
  }
}

export function pinTarget(path: readonly EventTarget[], host: Element): Element | null {
  if (path.includes(host)) return null;
  for (const entry of path) {
    if ((entry as Partial<Node>).nodeType === 1) return entry as unknown as Element;
  }
  return null;
}

export function pointOffset(target: Element, clientX: number, clientY: number): Offset {
  const r = target.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}
