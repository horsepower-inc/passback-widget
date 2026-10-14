import type { Annotation, ChannelStatus, Screenshot } from '@passback/schema';
import type { ResolveTarget, Resolved } from '@passback/collectors';
import {
  assemblePayload,
  collectElement,
  reresolve,
  selectorChain,
  startTimeline,
} from '@passback/collectors';
import type { Hot } from './channel';
import { Celebration } from './completion';
import { connection } from './connection';
import { flyToLauncher } from './fly';
import { dismissMarks } from './dismiss-marks';
import { hideMarks } from './hide-marks';
import { outlineLabel } from './outline-label';
import { palette } from './palette';
import { pullRequestOf } from './pr-link';
import { rest } from './rest';
import { sendAll } from './send-all';
import type { SendResult } from './send';
import { createTransport } from './transport';

export type CollectOptions = {
  win: Window;
  hot?: Hot;
  endpoint?: string;
  onStatus(status: ChannelStatus): void;
};
export type Collector = {
  relay: boolean;
  send(
    el: Element,
    comment: string,
    extra?: { screenshot?: Screenshot; annotations?: Annotation[] },
  ): Promise<SendResult>;
  selectorOf(el: Element): string;
  targetOf(el: Element): ResolveTarget;
  reresolve(root: Document | Element, target: ResolveTarget): Resolved | null;
  dispose(): void;
};
export type CollectFactory = (opts: CollectOptions) => Collector;

const NO_TARGET_MESSAGE = 'no HMR channel and no endpoint to POST to';

/** Entry of the lazy collector chunk: records the timeline from first arm, assembles the payload and sends it. */
export const collect: CollectFactory = ({ win, hot, endpoint, onStatus }) => {
  const timeline = startTimeline(win);
  const transport = createTransport({
    hot,
    endpoint: endpoint ?? '',
    onStatus,
    pullRequest: () => pullRequestOf(win),
  });
  let disposed = false;

  return {
    relay: !hot,
    async send(el, comment, extra) {
      if (!hot && !endpoint) return { ok: false, reason: 'network', message: NO_TARGET_MESSAGE };
      try {
        const payload = assemblePayload({ el, comment, win, timeline: timeline.snapshot() });
        if (extra?.screenshot !== undefined) payload.screenshot = extra.screenshot;
        if (extra?.annotations?.length) {
          payload.intent = { ...payload.intent, annotations: extra.annotations };
        }
        return await transport.send(payload);
      } catch (err) {
        return {
          ok: false,
          reason: 'rejected',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    selectorOf: (el) => selectorChain(el)[0]?.value ?? el.tagName.toLowerCase(),
    targetOf: (el) => collectElement(el),
    reresolve,
    dispose() {
      if (disposed) return;
      disposed = true;
      timeline.stop();
      transport.dispose();
    },
  };
};

const scope = globalThis as { __passback?: Record<string, unknown> };
scope.__passback = Object.assign(scope.__passback ?? {}, {
  collect,
  fx: {
    celebrate: (...args: ConstructorParameters<typeof Celebration>) => new Celebration(...args),
    fly: flyToLauncher,
    addons: [palette, rest, hideMarks, dismissMarks, sendAll, outlineLabel, connection],
  },
});
globalThis.document?.dispatchEvent(new Event('passback:fx'));
