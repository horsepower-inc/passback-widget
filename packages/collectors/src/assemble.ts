import type { Payload } from '@passback/schema';
import type { TimelineEvent } from '@passback/schema';
import { collectElement } from './element';
import { collectRects } from './rects';
import { collectStyles } from './styles';
import { collectFlags } from './flags';
import { collectText, type MeasureFont } from './text';
import { collectReactChain } from './react';
import { collectVueChain } from './vue';
import { collectRuntime, type RuntimeGetters } from './runtime';
import { collectEnvironment } from './environment';

export type AssembleInput = {
  el: Element;
  comment: string;
  win: Window;
  timeline: TimelineEvent[];
  getters?: RuntimeGetters;
  measure?: MeasureFont;
};

interface PassbackGlobal {
  __passback?: { buildId?: unknown };
}

function buildId(win: Window): string | undefined {
  const id = (win as unknown as PassbackGlobal).__passback?.buildId;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

export function assemblePayload(input: AssembleInput): Payload {
  const { el, comment, win, timeline, getters, measure } = input;

  const id = buildId(win);
  const react = collectReactChain(el);
  const chain = react.framework === 'unknown' ? collectVueChain(el) : react;
  const code = { ...chain, ...(id === undefined ? {} : { buildId: id }) };

  const text = collectText(el, measure);
  const visual = {
    rects: collectRects(el),
    styles: collectStyles(el),
    flags: collectFlags(el),
    ...(text === undefined ? {} : { text }),
  };

  return {
    schemaVersion: 1,
    code,
    element: collectElement(el),
    visual,
    runtime: collectRuntime(el, win, getters),
    timeline,
    environment: collectEnvironment(win),
    intent: { comment, annotations: [] },
  };
}
