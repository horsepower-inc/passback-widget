import { mountInk } from './shot-ink';
import { mountVeil, type Veil } from './shot-veil';
import { mountTools, type Tools, type ToolsOptions } from './shot-tools';
import type { Ink } from './shot-ink';
import { grabViewport } from './shot-grab';
import { uploadShot, type UploadResult } from './shot-upload';
import { toAnnotations } from './shot-annotate';
import type { Annotation } from '@passback/schema';
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
};

async function finishShot(ink: Ink, deps: FinishDeps, element: Element): Promise<ShotOutcome> {
  const { win, host, uploadUrl, fetchFn, local } = deps;
  let annotations: Annotation[] = [];
  try {
    if (ink.shapes().length === 0) return {};
    annotations = toAnnotations(ink.shapes(), element.getBoundingClientRect());
    const capture = await grabViewport({ win, host, shapes: ink.shapes(), local });
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
    side: 'right', tool: (parent?.dataset.shape as Ink['tool'] | undefined) ?? ink.tool, parent,
    onTool: (tool) => { ink.tool = tool; },
    onUndo: () => ink.undo(), onClear: () => ink.clear(),
  };
}

export const openShot: ShotOpen = ({ win, root, host, uploadUrl, fetchFn, local, active: start = true }) => {
  let tools: Tools | undefined;
  let veil: Veil | undefined;
  let active = false;
  let closed = false;
  const bar = root.querySelector<HTMLElement>('[data-role="tools"]') ?? undefined;
  const ink = mountInk(root, win, (count) => tools?.setCount(count));
  const addTools = (): void => {
    const options = toolsOf(ink, bar);
    ink.tool = options.tool;
    tools = mountTools(root, options);
    tools.setCount(ink.shapes().length);
  };
  const removeControls = (): void => {
    veil?.destroy();
    tools?.destroy();
    veil = tools = undefined;
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
    count: () => closed ? 0 : ink.shapes().length,
    finish: async (element) => (closed ? {} : finishShot(ink, { win, host, uploadUrl, fetchFn, local }, element)),
    close() {
      if (closed) return;
      closed = true;
      ink.destroy();
      removeControls();
    },
  };
  if (bar) addTools();
  if (start) session.setActive(true);
  else ink.setActive(false);
  return session;
};

const scope = globalThis as { __passback?: Record<string, unknown> };
scope.__passback = Object.assign(scope.__passback ?? {}, { shot: openShot });
