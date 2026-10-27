import { mountInk } from './shot-ink';
import { mountVeil, type Veil } from './shot-veil';
import { mountTools, type Tools, type ToolsOptions } from './shot-tools';
import type { Ink } from './shot-ink';
import { grabViewport } from './shot-grab';
import { uploadShot, type UploadResult } from './shot-upload';
import { toAnnotations } from './shot-annotate';
import type { Annotation } from '@passback/schema';
import { marksOf, type ShotPin } from './shot-paint';
import type { SubmitDetail } from './overlay-submit';
import { mountDrawingSend } from './shot-send';
import type { ShotOpen, ShotOutcome, ShotSession } from './shot-loader';

const PLAN_NOTE = 'Screenshot not attached: pictures come with Premium.';
const unattached: ShotOutcome = { note: 'Screenshot not attached' };

const outcomeOf = (result: UploadResult): ShotOutcome => {
  if (result.ok) return { screenshot: result.screenshot };
  return result.code === 'plan_required' ? { note: PLAN_NOTE } : unattached;
};

const withVectors = (outcome: ShotOutcome, annotations: Annotation[]): ShotOutcome =>
  annotations.length > 0 ? { ...outcome, annotations } : outcome;

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
    const capture = await grabViewport({
      win,
      host,
      shapes: ink.shapes(),
      marks: marksOf(pinsOf(detail), win),
      local,
    });
    if (!capture.ok) return withVectors(unattached, annotations);
    const { blob, mime, width, height, masked } = capture;
    const result = await uploadShot({ url: uploadUrl, blob, mime, width, height, masked, fetchFn });
    return withVectors(outcomeOf(result), annotations);
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
    parent: () => tools?.element,
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
