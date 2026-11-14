import {
  pushShape,
  undoShape,
  shiftShapes,
  shapePath,
  SHAPE_STROKE,
  SHAPE_INK,
  type Shape,
  type Tool,
} from './shot-shapes';

export type Ink = {
  tool: Tool;
  shapes(): readonly Shape[];
  undo(): void;
  clear(): void;
  setActive(on: boolean): void;
  destroy(): void;
};

type State = {
  svg: SVGSVGElement;
  list: readonly Shape[];
  stroke: { id: number; shape: Shape } | null;
  active: boolean;
};

function paint(state: State): void {
  const shapes = state.stroke ? [...state.list, state.stroke.shape] : state.list;
  state.svg.replaceChildren(
    ...shapes.map((shape) => {
      const path = state.svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', shapePath(shape));
      return path;
    }),
  );
}

function drop(state: State): void {
  state.stroke = null;
  paint(state);
}

function replace(state: State, list: readonly Shape[], onChange: (count: number) => void): void {
  const count = state.list.length;
  state.list = list;
  paint(state);
  if (count !== list.length) onChange(list.length);
}

function pointerHandlers(state: State, ink: Ink, onChange: (count: number) => void) {
  const down = (event: PointerEvent): void => {
    if (!state.active || state.stroke || (event.pointerType === 'mouse' && event.button !== 0))
      return;
    try {
      state.svg.setPointerCapture(event.pointerId);
    } catch {
      /* Test DOMs and synthetic pointer ids cannot capture. */
    }
    const point = { x: event.clientX, y: event.clientY };
    state.stroke = { id: event.pointerId, shape: { tool: ink.tool, from: point, to: point } };
    paint(state);
    event.preventDefault();
  };
  const move = (event: PointerEvent): void => {
    if (state.stroke?.id !== event.pointerId) return;
    state.stroke.shape.to = { x: event.clientX, y: event.clientY };
    paint(state);
  };
  const up = (event: PointerEvent): void => {
    if (state.stroke?.id !== event.pointerId) return;
    const list = pushShape(state.list, state.stroke.shape);
    state.stroke = null;
    replace(state, list, onChange);
  };
  const cancel = (event: PointerEvent): void => {
    if (state.stroke?.id === event.pointerId) drop(state);
  };
  return { pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel };
}

function listen(
  state: State,
  ink: Ink,
  win: Window,
  onChange: (count: number) => void,
): () => void {
  const handlers = pointerHandlers(state, ink, onChange);
  let lastX = win.scrollX;
  let lastY = win.scrollY;
  const scroll = (): void => {
    state.list = shiftShapes(state.list, lastX - win.scrollX, lastY - win.scrollY);
    lastX = win.scrollX;
    lastY = win.scrollY;
    drop(state);
  };
  const keydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !state.stroke) return;
    drop(state);
    event.preventDefault();
    event.stopPropagation();
  };
  for (const [type, handler] of Object.entries(handlers))
    state.svg.addEventListener(type, handler as EventListener);
  win.addEventListener('keydown', keydown, true);
  win.addEventListener('scroll', scroll, { passive: true });
  return () => {
    for (const [type, handler] of Object.entries(handlers))
      state.svg.removeEventListener(type, handler as EventListener);
    win.removeEventListener('keydown', keydown, true);
    win.removeEventListener('scroll', scroll);
  };
}

export function mountInk(root: ShadowRoot, win: Window, onChange: (count: number) => void): Ink {
  const svg = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-role', 'ink');
  svg.style.cssText = `position:fixed;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair;pointer-events:auto;fill:none;stroke:var(--pb-color-ink,${SHAPE_INK});stroke-width:${SHAPE_STROKE};stroke-linecap:round;stroke-linejoin:round`;
  root.insertBefore(svg, root.firstChild);
  const state: State = { svg, list: [], stroke: null, active: true };
  const ink: Ink = {
    tool: 'arrow',
    shapes: () => state.list,
    undo: () => replace(state, undoShape(state.list), onChange),
    clear: () => replace(state, [], onChange),
    setActive: (on) => {
      state.active = on;
      svg.style.pointerEvents = on ? 'auto' : 'none';
      if (!on) drop(state);
    },
    destroy: () => {
      state.active = false;
      drop(state);
      unlisten();
      svg.remove();
    },
  };
  const unlisten = listen(state, ink, win, onChange);
  return ink;
}
