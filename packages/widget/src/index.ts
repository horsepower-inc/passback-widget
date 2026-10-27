import type { Boundary } from './boundary';
import { createBoundary } from './boundary';
import { sendOrphaned } from './channel';
import type { Collector, CollectOptions } from './collect';
import { loadCollectFactory, readScriptConfig } from './collector-loader';
import { readConfig } from './config';
import { watchHmr, type Hot } from './hmr';
import { mount } from './mount';
import type { Overlay, SubmitDetail } from './overlay';
import { createOverlay } from './overlay';
import { sendBatch, type SubmitAllDetail } from './send-batch';
import { pullRequestOf } from './pr-link';
import { reopenOf } from './reopen';
import { orphanedIds } from './reattach';
import { pingSeen } from './seen';
import { installStyles } from './styles';
import { createShotStep, drawingOf, shotExtra, type ShotStep } from './shot-step';
import { applyTheme } from './theme';

declare const __PB_LOCAL__: boolean;

export type Widget = {
  stop(): void;
  acked(id: string, trimmed: boolean): void;
  failed(message: string): void;
  relay(): unknown;
};

type WidgetState = {
  unmount: (() => void) | null;
  overlay: Overlay | null;
  stopHmr: (() => void) | null;
  collecting: Promise<Collector> | null;
  collector: Collector | null;
  step: ShotStep | null;
  relay: unknown;
};

const LOAD_FAILED = 'Passback could not finish loading.';

const instances = new WeakMap<Document, Widget>();

let pendingAutoStart: (() => void) | null = null;

function cancelAutoStart(): void {
  if (pendingAutoStart === null) return;
  document.removeEventListener('DOMContentLoaded', pendingAutoStart);
  pendingAutoStart = null;
}

function disposeCollector(state: WidgetState): void {
  const pending = state.collecting;
  state.collecting = null;
  state.collector?.dispose();
  state.collector = null;
  pending?.then(
    (collector) => collector.dispose(),
    () => undefined,
  );
}

function ensureCollector(
  doc: Document,
  win: Window & typeof globalThis,
  state: WidgetState,
  hot: CollectOptions['hot'],
): Promise<Collector> {
  if (state.collecting) return state.collecting;
  const collecting = loadCollectFactory(doc, win).then((factory) => {
    if (state.overlay === null) throw new Error('passback: the widget was stopped');
    const collector = factory({
      win,
      hot,
      endpoint: readScriptConfig(doc).endpoint,
      onStatus: (event) => state.overlay?.status(event),
    });
    state.collector = collector;
    return collector;
  });
  state.collecting = collecting;
  collecting.catch(() => {
    if (state.collecting === collecting) state.collecting = null;
  });
  return collecting;
}

function loadOrNull(load: () => Promise<Collector>): Promise<Collector | null> {
  return load().catch(() => null);
}

function loadOrExplain(load: () => Promise<Collector>): Promise<Collector> {
  return load().catch(() => {
    throw new Error(LOAD_FAILED);
  });
}

function report(
  state: WidgetState,
  result: Awaited<ReturnType<Collector['send']>>,
  note: string | undefined,
  relay: boolean,
): void {
  if (!result.ok) state.overlay?.failed(result.message);
  else state.overlay?.acked(result.id, result.trimmed, note, { relay });
}

async function sendMark(
  state: WidgetState,
  detail: SubmitDetail,
  load: () => Promise<Collector>,
  step: ShotStep,
): Promise<void> {
  try {
    // First await: getDisplayMedia needs the user activation of the Send click.
    const outcome = await step.finish(detail.element);
    const collector = await loadOrNull(load);
    if (collector === null) return void state.overlay?.failed(LOAD_FAILED);
    const extra = shotExtra(outcome);
    const result = await (extra
      ? collector.send(detail.element, detail.comment, extra)
      : collector.send(detail.element, detail.comment));
    report(state, result, outcome.note, collector.relay);
  } catch (err) {
    state.overlay?.failed(err instanceof Error ? err.message : String(err));
  }
}

function teardownWidget(doc: Document, widget: Widget, state: WidgetState): void {
  if (doc === document) cancelAutoStart();
  state.stopHmr?.();
  state.stopHmr = null;
  disposeCollector(state);
  state.step?.close();
  state.step = null;
  state.overlay?.destroy();
  state.overlay = null;
  state.unmount?.();
  state.unmount = null;
  if (instances.get(doc) === widget) {
    instances.delete(doc);
  }
}

function openStep(
  doc: Document,
  win: Window & typeof globalThis,
  mounted: ReturnType<typeof mount>,
  state: WidgetState,
): ShotStep {
  return (state.step = createShotStep({
    doc,
    win,
    root: mounted.root,
    host: mounted.host,
    onLoadFailed: () => state.overlay?.setDrawing(false),
  }));
}

function hotOf(
  win: Window & typeof globalThis,
): (Hot & Parameters<typeof sendOrphaned>[0] & CollectOptions['hot']) | undefined {
  return (
    win as unknown as {
      __passback?: { hot?: Hot & Parameters<typeof sendOrphaned>[0] & CollectOptions['hot'] };
    }
  ).__passback?.hot;
}

function pingOnStart(
  doc: Document,
  win: Window & typeof globalThis,
  state: WidgetState,
  onPaused: () => void,
): void {
  const endpoint = readScriptConfig(doc).endpoint;
  if (typeof endpoint === 'string' && endpoint !== '') {
    void pingSeen(endpoint, win, (body) => (state.relay = body)).then((status) => {
      if (status === 402 && hotOf(win) === undefined) onPaused();
    });
  }
}

function mountWidget(
  doc: Document,
  win: Window & typeof globalThis,
  boundary: Boundary,
  state: WidgetState,
): void {
  pullRequestOf(win);
  const hot = typeof __PB_LOCAL__ === 'undefined' || __PB_LOCAL__ ? hotOf(win) : undefined;
  const mounted = mount(doc);
  applyTheme(mounted.host, doc, win);
  state.unmount = mounted.unmount;
  installStyles(mounted.root, doc);
  const step = openStep(doc, win, mounted, state);
  state.overlay = createOverlay({
    doc,
    root: mounted.root,
    host: mounted.host,
    ready: () => loadOrExplain(() => ensureCollector(doc, win, state, hot)),
    selectorOf: (el) => state.collector!.selectorOf(el),
    targetOf: (el) => state.collector!.targetOf(el),
    onSubmit: (detail: SubmitDetail) => {
      mounted.host.dispatchEvent(
        new win.CustomEvent('passback:submit', { detail, bubbles: false }),
      );
      void sendMark(state, detail, () => ensureCollector(doc, win, state, hot), step);
    },
    onArm: () => {
      ensureCollector(doc, win, state, hot).catch(() => undefined);
    },
    guard: boundary.guard,
    reopen: typeof __PB_LOCAL__ === 'undefined' || __PB_LOCAL__ ? reopenOf(win) : undefined,
    ...drawingOf(step),
  });
  const overlay = state.overlay;
  mounted.host.addEventListener(
    'passback:submit-all',
    boundary.guard((event: Event) => {
      const detail = (event as CustomEvent<SubmitAllDetail>).detail;
      void sendBatch(detail, () => ensureCollector(doc, win, state, hot), step);
    }),
  );
  if ((typeof __PB_LOCAL__ === 'undefined' || __PB_LOCAL__) && hot) {
    state.stopHmr = watchHmr({
      hot,
      win,
      marks: () => overlay.openMarks(),
      resolve: (mark) => state.collector?.reresolve(doc, mark.target)?.element ?? null,
      onRestored: boundary.guard((results, view) => {
        overlay.reattach(results, view);
        sendOrphaned(hot, orphanedIds(results));
      }),
    });
  }
}

export function start(doc: Document = document, win: Window & typeof globalThis = window): Widget {
  const active = instances.get(doc);
  if (active) return active;

  const state: WidgetState = {
    unmount: null,
    overlay: null,
    stopHmr: null,
    collecting: null,
    collector: null,
    step: null,
    relay: null,
  };

  function teardown(): void {
    teardownWidget(doc, widget, state);
  }

  function onTrip(): void {
    teardown();
    console.warn('[passback] widget error, overlay removed');
  }

  const boundary = createBoundary(onTrip);

  const widget: Widget = {
    stop(): void {
      teardown();
    },
    acked(id: string, trimmed: boolean): void {
      boundary.guard(() => state.overlay?.acked(id, trimmed))();
    },
    failed(message: string): void {
      boundary.guard(() => state.overlay?.failed(message))();
    },
    relay: () => state.relay,
  };
  instances.set(doc, widget);

  boundary.guard(() => mountWidget(doc, win, boundary, state))();
  if (state.overlay !== null) {
    pingOnStart(doc, win, state, () => {
      if (instances.get(doc) === widget) {
        teardown();
        console.info('[passback] this site is paused, so the widget is hidden');
      }
    });
  }

  return widget;
}

function autoStart(): void {
  if (!readConfig(document, window).autoStart) return;

  if (document.readyState === 'loading') {
    pendingAutoStart = () => {
      pendingAutoStart = null;
      start();
    };
    document.addEventListener('DOMContentLoaded', pendingAutoStart, { once: true });
    return;
  }

  start();
}

if (typeof document !== 'undefined') {
  autoStart();
}
