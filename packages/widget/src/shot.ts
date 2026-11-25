import { mountInk } from './shot-ink';
import { mountVeil, type Veil } from './shot-veil';
import { mountTools, type Tools, type ToolsOptions } from './shot-tools';
import type { Ink } from './shot-ink';
import { grabViewport } from './shot-grab';
import { uploadShot, type UploadResult } from './shot-upload';
import { toAnnotations } from './shot-annotate';
import type { Annotation } from '@passback/schema';
import { marksOf, type ShotPin } from './shot-paint';
import { SHAPE_HEAD, type Shape } from './shot-shapes';
import type { View } from './shot-dom';
import type { SubmitDetail } from './overlay-submit';
import { mountDrawingSend } from './shot-send';
import type { ShotOpen, ShotOutcome, ShotSession } from './shot-loader';

const PLAN_NOTE = 'Screenshot not attached: pictures come with Premium.';
const unattached: ShotOutcome = { note: 'Screenshot not attached' };

const outcomeOf = (result: UploadResult): ShotOutcome => {
  if (result.ok) return { screenshot: result.screenshot };
  return result.code === 'plan_required' ? { note: PLAN_NOTE } : unattached;
};

// A picture shows every drawing, so the mark names only each drawing's kind.
const kindsOf = (annotations: Annotation[]): Annotation[] =>
  annotations.map((a) => ({ type: a.type as 'arrow' | 'line' | 'box' | 'pencil' }));

const withVectors = (outcome: ShotOutcome, annotations: Annotation[]): ShotOutcome =>
  annotations.length > 0 ? { ...outcome, annotations } : outcome;

const MAX_VIEWPORTS = 3;

const spanOf = (shape: Shape): [number, number] => {
  const ys = (shape.path ?? [shape.from, shape.to]).map((p) => p.y);
  return [Math.min(shape.from.y, shape.to.y, ...ys), Math.max(shape.from.y, shape.to.y, ...ys)];
};

const noteOf = (n: number): string =>
  `${n} ${n === 1 ? 'drawing' : 'drawings'} outside the picture`;

// The band of the page, in viewport coordinates, from the top of the highest shape or the marked
// element to the bottom of the lowest, padded by a stroke and an arrowhead. Null when every shape
// lies inside the viewport, which then stays the picture however far the marked element reaches.
// The band keeps the viewport whole when that still fits the cap. When the band itself is too
// tall the picture is the cap centred on the marked element, and `outside` counts the shapes
// wholly outside it.
function regionOf(
  win: Window,
  shapes: readonly Shape[],
  element: Element,
): { view: View | null; outside: number } {
  const vh = win.innerHeight;
  const spans = shapes.map(spanOf);
  if (spans.every(([a, b]) => a >= 0 && b <= vh)) return { view: null, outside: 0 };
  const box = element.isConnected ? element.getBoundingClientRect() : undefined;
  const known = box && Number.isFinite(box.top) && Number.isFinite(box.bottom) ? box : undefined;
  const tops = spans.map((p) => p[0]).concat(known ? [known.top] : []);
  const bottoms = spans.map((p) => p[1]).concat(known ? [known.bottom] : []);
  const top = Math.max(Math.floor(Math.min(...tops) - SHAPE_HEAD), -win.scrollY);
  const bottom = Math.ceil(Math.max(...bottoms) + SHAPE_HEAD);
  const cap = MAX_VIEWPORTS * vh;
  if (bottom - top > cap) {
    // Three viewport heights centred on the marked element (the viewport when it is unknown),
    // kept below the top of the page; the shapes wholly outside that band are counted.
    const middle = known ? (known.top + known.bottom) / 2 : vh / 2;
    const from = Math.max(Math.round(middle - cap / 2), -win.scrollY);
    // An arrowhead reaches SHAPE_HEAD beyond its end, so a shape counts as outside only past that.
    const outside = spans.filter(
      ([a, b]) => b + SHAPE_HEAD < from || a - SHAPE_HEAD > from + cap,
    ).length;
    return { view: { top: from, height: cap }, outside };
  }
  const [wideTop, wideBottom] = [Math.min(top, 0), Math.max(bottom, vh)];
  if (wideBottom - wideTop <= cap)
    return { view: { top: wideTop, height: wideBottom - wideTop }, outside: 0 };
  return { view: { top, height: bottom - top }, outside: 0 };
}

type FinishDeps = {
  win: Window;
  host: HTMLElement;
  uploadUrl: string;
  fetchFn?: typeof fetch;
  local?: boolean;
  capture?: () => boolean;
};

const pinsOf = (detail: SubmitDetail | undefined): readonly ShotPin[] =>
  detail === undefined
    ? []
    : (detail.marks ?? [{ element: detail.element, offset: detail.offset, n: 1, current: true }]);

async function finishShot(
  ink: Ink,
  deps: FinishDeps,
  element: Element,
  detail?: SubmitDetail,
  opts?: { picture?: boolean },
): Promise<ShotOutcome> {
  const { win, host, uploadUrl, fetchFn, local, capture: pictures } = deps;
  let annotations: Annotation[] = [];
  try {
    annotations = toAnnotations(ink.shapes(), element.getBoundingClientRect());
    if (opts?.picture === false || (pictures && !pictures())) return withVectors({}, annotations);
    const { view, outside } = regionOf(win, ink.shapes(), element);
    const capture = await grabViewport({
      win,
      host,
      shapes: ink.shapes(),
      marks: marksOf(pinsOf(detail), win, view ?? undefined),
      region: view ?? undefined,
      local,
    });
    if (!capture.ok) return withVectors(unattached, annotations);
    const { blob, mime, width, height, masked } = capture;
    const result = await uploadShot({ url: uploadUrl, blob, mime, width, height, masked, fetchFn });
    const outcome = outcomeOf(result);
    const noted = result.ok && outside > 0 ? { ...outcome, note: noteOf(outside) } : outcome;
    return withVectors(noted, result.ok ? kindsOf(annotations) : annotations);
  } catch {
    return withVectors(unattached, annotations);
  }
}

function toolsOf(ink: Ink, parent: HTMLElement | undefined): ToolsOptions {
  return {
    side: 'right',
    tool: (parent?.dataset.shape as Ink['tool'] | undefined) ?? ink.tool,
    parent,
    onTool: (tool) => {
      ink.tool = tool;
    },
    onUndo: () => ink.undo(),
    onClear: () => ink.clear(),
  };
}

export const openShot: ShotOpen = (opts) => {
  const { win, root, host } = opts;
  let tools: Tools | undefined;
  let veil: Veil | undefined;
  let active = false;
  let closed = false;
  const bar = root.querySelector<HTMLElement>('[data-role="tools"]') ?? undefined;
  const send = mountDrawingSend({
    win,
    root,
    active: () => active && !closed,
    count: () => ink.shapes().length,
  });
  const ink = mountInk(root, win, (count) => {
    tools?.setCount(count);
    send.sync();
  });
  const addTools = (): void => {
    const options = toolsOf(ink, bar);
    ink.tool = options.tool;
    tools = mountTools(root, options);
    tools.setCount(ink.shapes().length);
    send.sync();
  };
  const removeControls = (): void => {
    veil?.destroy();
    tools?.destroy();
    veil = tools = undefined;
    send.sync();
  };
  const session: ShotSession = {
    setActive(on) {
      if (closed || active === on) return;
      active = on;
      ink.setActive(on);
      send.sync();
      if (!on) {
        veil?.destroy();
        veil = undefined;
        return bar ? undefined : removeControls();
      }
      veil = mountVeil(root, win, host);
      if (!tools) addTools();
    },
    count: () => (closed ? 0 : ink.shapes().length),
    finish: async (element, detail, finishOpts) =>
      closed ? {} : finishShot(ink, opts, element, detail, finishOpts),
    bind(ctx) {
      if (!closed) send.bind(ctx);
    },
    close() {
      if (closed) return;
      closed = true;
      send.destroy();
      ink.destroy();
      removeControls();
    },
  };
  if (bar) addTools();
  if (opts.active ?? true) session.setActive(true);
  else ink.setActive(false);
  return session;
};

const scope = globalThis as { __passback?: Record<string, unknown> };
scope.__passback = Object.assign(scope.__passback ?? {}, { shot: openShot });
