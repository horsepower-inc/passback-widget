import type { Annotation, ChannelStatus, Payload, Screenshot } from '@passback/schema';
import type { ResolveTarget, Resolved } from '@passback/collectors';
import { autoVerify } from '@passback/collectors/geometry';
import {
  assemblePayload,
  collectRects,
  collectElement,
  reresolve,
  routePattern,
  selectorChain,
  startTimeline,
  watchNavigation,
} from '@passback/collectors';
import type { Hot } from './channel';
import { Celebration } from './completion';
import { connection } from './connection';
import { cornerPins } from './corner-pins';
import { dictationHint } from './dictation-hint';
import { voiceMic } from './voice-mic';
import { flyToLauncher } from './fly';
import { dismissMarks } from './dismiss-marks';
import { hideMarks } from './hide-marks';
import { inboxTool } from './inbox-tool';
import { outlineLabel } from './outline-label';
import { palette } from './palette';
import { pullRequestOf } from './pr-link';
import { rest } from './rest';
import { sendAll } from './send-all';
import { targetOutline } from './target-outline';
import { single, type BatchSendResult, type SendResult } from './send';
import { createTransport } from './transport';

export type CollectOptions = {
  win: Window;
  hot?: Hot;
  endpoint?: string;
  onStatus(status: ChannelStatus): void;
};
type Scope = { __passback?: { reviewRoute?(payloads: Payload[]): Promise<BatchSendResult> } };
type SendExtra = { screenshot?: Screenshot; annotations?: Annotation[] };
export type BatchItem = { el: Element; comment: string; extra?: SendExtra };
export type Collector = {
  relay: boolean;
  send(el: Element, comment: string, extra?: SendExtra): Promise<SendResult>;
  // Optional: the main bundle and the collector chunk load from the CDN separately.
  sendBatch?(
    items: readonly BatchItem[],
    opts?: { dest?: 'agent' | 'tracker' },
  ): Promise<BatchSendResult>;
  selectorOf(el: Element): string;
  targetOf(el: Element): ResolveTarget;
  reresolve(root: Document | Element, target: ResolveTarget): Resolved | null;
  // Optional: an older chunk lacks it.
  measure?(
    root: Document | Element,
    target: ResolveTarget,
    annotations: readonly Annotation[],
  ): 'closed' | 'open' | 'unchecked';
  // Optional: an older chunk lacks it. The route pattern a mark made now would record.
  route?(): string;
  // Optional: an older chunk lacks it. Calls cb when the route pattern changes; returns the stop function.
  onRoute?(cb: () => void): () => void;
  dispose(): void;
};
export type CollectFactory = (opts: CollectOptions) => Collector;

const NO_TARGET_MESSAGE = 'no HMR channel and no endpoint to POST to';
const NO_RELAY_MESSAGE = 'this page has no relay endpoint to file to.';

/**
 * Route-change subscriptions over one history wrapper per collector: stopping subscribers in any order never strands
 * a wrapper on top of the timeline's. A callback runs only when the route pattern differs from the one it last saw.
 */
function routeWatch(win: Window) {
  const subs = new Set<{ cb: () => void; known: string }>();
  let stopNavigation: (() => void) | undefined;
  const stop = () => {
    subs.clear();
    stopNavigation?.();
    stopNavigation = undefined;
  };
  const changed = () => {
    const next = routePattern(win);
    for (const s of [...subs]) {
      if (next === s.known || !subs.has(s)) continue;
      s.known = next;
      try {
        s.cb();
      } catch {
        // One subscriber's failure does not silence the others.
      }
    }
  };
  const on = (cb: () => void) => {
    const sub = { cb, known: routePattern(win) };
    subs.add(sub);
    stopNavigation ??= watchNavigation(win, changed);
    return () => void (subs.delete(sub) && !subs.size && stop());
  };
  return { on, stop };
}

/** Entry of the lazy collector chunk: records the timeline from first arm, assembles the payload and sends it. */
export const collect: CollectFactory = ({ win, hot, endpoint, onStatus }) => {
  const timeline = startTimeline(win);
  const pullRequest = () => pullRequestOf(win);
  const transport = createTransport({
    hot,
    endpoint: endpoint ?? '',
    onStatus,
    pullRequest,
  });
  let relayTransport = hot ? undefined : transport;
  let disposed = false;
  const routes = routeWatch(win);
  // Set by the review chunk once a session read has answered: a comment then belongs to the session.
  const reviewRoute = () => (win as unknown as Scope).__passback?.reviewRoute;
  const payloadOf = ({ el, comment, extra }: BatchItem) => {
    const payload = assemblePayload({ el, comment, win, timeline: timeline.snapshot() });
    if (extra?.screenshot !== undefined) payload.screenshot = extra.screenshot;
    if (extra?.annotations?.length) {
      payload.intent = { ...payload.intent, annotations: extra.annotations };
    }
    return payload;
  };

  return {
    relay: !hot,
    async send(el, comment, extra) {
      const review = reviewRoute();
      if (!review && !hot && !endpoint) {
        return { ok: false, reason: 'network', message: NO_TARGET_MESSAGE };
      }
      try {
        const payload = payloadOf({ el, comment, extra });
        return await (review ? review([payload]).then(single) : transport.send(payload));
      } catch (err) {
        return {
          ok: false,
          reason: 'rejected',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async sendBatch(items, opts) {
      const tracker = opts?.dest === 'tracker';
      const review = reviewRoute();
      if (!review && !endpoint && (tracker || !hot)) {
        const message = tracker ? NO_RELAY_MESSAGE : NO_TARGET_MESSAGE;
        return { ok: false, reason: 'network', message };
      }
      try {
        if (review) return await review(items.map(payloadOf));
        if (tracker)
          relayTransport ??= createTransport({ endpoint: endpoint!, onStatus, pullRequest });
        return await (tracker ? relayTransport! : transport).sendBatch(items.map(payloadOf));
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
    route: () => routePattern(win),
    onRoute: routes.on,
    measure(root, target, annotations) {
      try {
        const element = reresolve(root, target)?.element;
        return element ? autoVerify(annotations, collectRects(element)).verdict : 'unchecked';
      } catch {
        return 'unchecked';
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Before the timeline: a history wrapper is restored only while it is the installed one.
      routes.stop();
      timeline.stop();
      transport.dispose();
      relayTransport?.dispose();
    },
  };
};

const scope = globalThis as { __passback?: Record<string, unknown> };
scope.__passback = Object.assign(scope.__passback ?? {}, {
  collect,
  fx: {
    celebrate: (...args: ConstructorParameters<typeof Celebration>) => new Celebration(...args),
    fly: flyToLauncher,
    addons: [
      palette,
      rest,
      hideMarks,
      dismissMarks,
      sendAll,
      outlineLabel,
      connection,
      inboxTool,
      cornerPins,
      targetOutline,
      dictationHint,
      voiceMic,
    ],
  },
});
globalThis.document?.dispatchEvent(new Event('passback:fx'));
