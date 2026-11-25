import { loadShotOpen, readShotConfig } from './shot-loader';
import { startRelayPolicy, watchRelayPolicy } from './relay-policy';
import { isSandboxShot } from './sandbox-shot';
import { dispatch, type Drawing, type FlowCtx } from './overlay-draw';
import type { SubmitDetail } from './overlay-submit';
import type { ShotOutcome, ShotSession } from './shot-loader';

export type ShotStepDeps = {
  doc: Document;
  win: Window & typeof globalThis;
  root: ShadowRoot;
  host: HTMLElement;
  onLoadFailed(): void;
};
export type ShotStep = {
  enabled: boolean;
  off?(): boolean;
  toggle(on: boolean): void;
  finish(element: Element): Promise<ShotOutcome>;
  finishAll(details: readonly SubmitDetail[]): Promise<ShotOutcome[]>;
  close(): void;
  bind?(ctx: FlowCtx): void;
};

export function shotExtra(outcome: ShotOutcome): ShotOutcome | undefined {
  const { screenshot, annotations: shapes, note } = outcome;
  const annotations = shapes?.length ? shapes : undefined;
  // A note beside a picture says what the picture leaves out, so the recipient reads it too.
  return screenshot || annotations
    ? {
        ...(screenshot && { screenshot }),
        ...(annotations && { annotations }),
        ...(screenshot && note && { note }),
      }
    : undefined;
}

export function drawingOf(step: ShotStep): { drawing?: Drawing } {
  if (!step.enabled) return {};
  return { drawing: { toggle: step.toggle, cancel: step.close, bind: step.bind, off: step.off } };
}

async function finishSession(
  session: ShotSession | undefined,
  element: Element,
  detail: SubmitDetail | undefined,
  shapes = 0,
): Promise<ShotOutcome> {
  try {
    if (!session) return {};
    return await (shapes
      ? session.finish(element, detail, { picture: false })
      : session.finish(element, detail));
  } catch {
    return { note: 'Screenshot not attached' };
  }
}

function stepSettings(
  doc: Document,
  win: Window,
  host: HTMLElement,
  onOff: () => void,
): {
  enabled: boolean;
  uploadUrl: string;
  local?: boolean;
  capture: () => boolean;
  drawings: () => boolean;
} {
  const config = readShotConfig(doc);
  // Relay limits are discovered for every relay site, with or without the screenshot opt-in.
  startRelayPolicy(doc, win);
  const registered = (win as unknown as { __passback?: { shot?: unknown } }).__passback?.shot;
  // A session enabled through the sandbox alone never uploads.
  const { uploadUrl = '', local } = config as { uploadUrl?: string; local?: true };
  return {
    enabled: config.enabled || isSandboxShot(registered),
    uploadUrl,
    local,
    ...(uploadUrl && !local
      ? probePolicy(win, host, uploadUrl, onOff)
      : { capture: () => true, drawings: () => true }),
  };
}

const warned = new WeakSet<Window>();

// Asks the relay once what this site's plan allows: `screenshots: false` turns pictures off,
// `drawings: false` turns the pencil off too. Anything else leaves both on.
function probePolicy(
  win: Window,
  host: HTMLElement,
  url: string,
  onOff: () => void,
): { capture: () => boolean; drawings: () => boolean } {
  let [pictures, drawings] = [true, true];
  const warn = (line: string): void => {
    if (warned.has(win)) return;
    warned.add(win);
    console.warn(line);
  };
  // The answer is shared by the page: a replacement host gets the same decision without a request.
  watchRelayPolicy(win, url, (plan) => {
    if (plan.drawings === false) {
      pictures = drawings = false;
      host.setAttribute('data-pb-pictures', 'off');
      host.setAttribute('data-pb-drawing', 'off');
      warn(
        '[passback] Screenshots and drawings are off for this site: they need the Premium plan. https://passback.dev/pricing',
      );
      onOff();
    } else if (plan.screenshots === false) {
      pictures = false;
      host.setAttribute('data-pb-pictures', 'off');
      warn(
        '[passback] Screenshots are off for this site: pictures need the Premium plan. Drawings are sent as shapes only. https://passback.dev/pricing',
      );
    }
  });
  return { capture: () => pictures, drawings: () => drawings };
}

const REQUIRED = 'Screenshot required. Capture failed; retry to send.';
const READY_MS = 8000;

type Held = { keys: readonly object[]; promise: Promise<unknown> };

// Resolves with the session `start` opens within READY_MS, else rejects; `expire` runs on the timeout.
function within(start: () => Promise<ShotSession | undefined>, expire: () => void) {
  return new Promise<ShotSession>((resolve, reject) => {
    const fail = (): void => reject(new Error(REQUIRED));
    const timer = setTimeout(() => (expire(), fail()), READY_MS);
    const done = (opened: ShotSession | undefined): void => {
      clearTimeout(timer);
      if (opened) resolve(opened);
      else fail();
    };
    start().then(done, () => done(undefined));
  });
}

// One finishing per submission: the same keys reuse its promise; a failure is forgotten so Retry captures again.
// A submission closed or replaced while pending rejects, so its late outcome is never sent.
function createHold(release: () => void) {
  let held: Held | undefined;
  const has = (keys: readonly object[]): boolean =>
    !!held && keys.length === held.keys.length && keys.every((k, i) => k === held!.keys[i]);
  return {
    has,
    drop: (): void => void (held = undefined),
    run<T>(keys: readonly object[], start: () => Promise<T>): Promise<T> {
      if (has(keys)) return held!.promise as Promise<T>;
      const entry: Held = { keys, promise: undefined! };
      entry.promise = start().then(
        (outcome) => {
          if (held !== entry) throw new Error(REQUIRED);
          release();
          return outcome;
        },
        (error: unknown) => {
          if (held === entry) held = undefined;
          throw error;
        },
      );
      held = entry;
      return entry.promise as Promise<T>;
    },
  };
}

async function eachOf(
  details: readonly SubmitDetail[],
  one: (detail: SubmitDetail, shapes: number) => Promise<ShotOutcome>,
): Promise<ShotOutcome[]> {
  const outcomes: ShotOutcome[] = [];
  for (const detail of details) outcomes.push(await one(detail, outcomes.length));
  return outcomes;
}

// The session is read when finishing starts, so an open one is called before any await.
// The policy is read again afterwards: a relay `screenshots: false` may arrive while the chunk loads.
async function pictured(
  session: ShotSession | undefined,
  ready: () => Promise<ShotSession>,
  required: () => boolean,
  element: Element,
  detail?: SubmitDetail,
  shapes = 0,
): Promise<ShotOutcome> {
  const outcome = await finishSession(session ?? (await ready()), element, detail, shapes);
  if (!shapes && !outcome?.screenshot && required()) throw new Error(REQUIRED);
  return outcome;
}

// Pictures are required unless the relay said `screenshots: false`; local mode and the sandbox never upload.
function pictureRequired(
  win: Window,
  enabled: boolean,
  opt: { uploadUrl: string; local?: boolean; capture: () => boolean },
): boolean {
  const registered = (win as unknown as { __passback?: { shot?: unknown } }).__passback?.shot;
  return enabled && !!opt.uploadUrl && !opt.local && !isSandboxShot(registered) && opt.capture();
}

// A policy answer of `drawings: false` closes an open drawing: its shapes go, the comment draft stays.
function dropDrawing(ctx: FlowCtx | undefined, release: () => void): void {
  const open = ctx?.state.flow === 'drawing';
  release();
  if (ctx && open) dispatch(ctx, 'drawOff', true);
}

function trackSubmit(host: HTMLElement): () => SubmitDetail | undefined {
  let last: SubmitDetail | undefined;
  host.addEventListener('passback:submit', (event) => {
    last = (event as CustomEvent<SubmitDetail>).detail;
  });
  return () => last;
}

// An active load cancelled by toggle(false) before it arrives opens nothing.
export function createShotStep(deps: ShotStepDeps): ShotStep {
  const { doc, win, root, host } = deps;
  let closeDrawing = (): void => undefined;
  const { enabled, drawings, ...opt } = stepSettings(doc, win, host, () => closeDrawing());
  let bound: FlowCtx | undefined; // the overlay context, once its first dispatch has run
  let session: ShotSession | undefined;
  // epoch counts closes (a late load is dropped), wantOn is drawing wanted, preloaded one preload per epoch.
  let [epoch, wantOn, preloaded] = [0, false, false];

  function load(need = false): Promise<ShotSession | undefined> {
    const ticket = epoch;
    return loadShotOpen(doc, win)
      .then((open) => {
        if (ticket !== epoch) return undefined;
        if (session) session.setActive(wantOn);
        else if (wantOn || (preloaded && drawings()) || need)
          session = open({ win, root, host, ...opt, active: wantOn });
        session?.bind?.(bound!);
        return session;
      })
      .catch((error: unknown) => {
        if (ticket === epoch) {
          preloaded = false;
          if (wantOn) deps.onLoadFailed();
        }
        throw error;
      });
  }

  function ready(): Promise<ShotSession> {
    const ticket = epoch;
    return session
      ? Promise.resolve(session)
      : within(
          () => load(true),
          () => ticket === epoch && ([epoch, preloaded] = [epoch + 1, false]),
        );
  }

  // Frees the session without touching a retained outcome.
  function release(): void {
    epoch++;
    wantOn = preloaded = false;
    try {
      session?.close();
    } catch {
      // A session that fails to close must not stop the mark from being sent.
    }
    session = undefined;
  }

  closeDrawing = () => dropDrawing(bound, release);
  const holder = createHold(release);
  const close = (): void => (holder.drop(), release());
  const required = (): boolean => pictureRequired(win, enabled, opt);

  host.addEventListener('passback:preload', () => {
    if (!enabled || session || preloaded || !drawings()) return;
    preloaded = true;
    load().catch(() => undefined);
  });

  const submitted = trackSubmit(host);

  return {
    enabled,
    off: () => !drawings(),
    toggle(on) {
      if (on && !drawings()) return;
      wantOn = on;
      if (session) session.setActive(on);
      else if (on && enabled) load().catch(() => undefined);
    },
    async finish(element) {
      const detail = submitted()?.element === element ? submitted() : undefined;
      // A retained submission is reused even if `screenshots: false` arrived since.
      if (holder.has([detail ?? element]) || required())
        return holder.run([detail ?? element], () =>
          pictured(session, ready, required, element, detail),
        );
      const outcome = await finishSession(session, element, detail);
      close();
      return outcome;
    },
    async finishAll(details) {
      if (holder.has(details) || (required() && details.length > 0))
        return holder.run(details, () =>
          eachOf(details, (d, n) => pictured(session, ready, required, d.element, d, n)),
        );
      const outcomes = await eachOf(details, (d, n) => finishSession(session, d.element, d, n));
      close();
      return outcomes;
    },
    close,
    bind(ctx) {
      bound = ctx;
      session?.bind?.(ctx);
    },
  };
}
