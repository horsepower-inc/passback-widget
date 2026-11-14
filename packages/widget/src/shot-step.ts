import { loadShotOpen, readShotConfig } from './shot-loader';
import { isSandboxShot } from './sandbox-shot';
import type { Drawing, FlowCtx } from './overlay-draw';
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
  toggle(on: boolean): void;
  finish(element: Element): Promise<ShotOutcome>;
  finishAll(details: readonly SubmitDetail[]): Promise<ShotOutcome[]>;
  close(): void;
  bind?(ctx: FlowCtx): void;
};

export function shotExtra(outcome: ShotOutcome): ShotOutcome | undefined {
  const { screenshot, annotations: shapes } = outcome;
  const annotations = shapes?.length ? shapes : undefined;
  return screenshot || annotations
    ? { ...(screenshot && { screenshot }), ...(annotations && { annotations }) }
    : undefined;
}

export function drawingOf(step: ShotStep): { drawing?: Drawing } {
  if (!step.enabled) return {};
  return { drawing: { toggle: step.toggle, cancel: step.close, bind: step.bind } };
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
): { enabled: boolean; uploadUrl: string; local?: boolean; capture: () => boolean } {
  const config = readShotConfig(doc);
  const registered = (win as unknown as { __passback?: { shot?: unknown } }).__passback?.shot;
  // A session enabled through the sandbox alone never uploads.
  const { uploadUrl = '', local } = config as { uploadUrl?: string; local?: true };
  return {
    enabled: config.enabled || isSandboxShot(registered),
    uploadUrl,
    local,
    capture: uploadUrl && !local ? probePictures(win, host, uploadUrl) : () => true,
  };
}

const warned = new WeakSet<Window>();

// Asks the relay once whether this site may attach pictures; only a plain `screenshots: false` turns them off.
function probePictures(win: Window, host: HTMLElement, url: string): () => boolean {
  let pictures = true;
  const turnOff = (): void => {
    pictures = false;
    host.setAttribute('data-pb-pictures', 'off');
    if (warned.has(win)) return;
    warned.add(win);
    console.warn(
      '[passback] Screenshots are off for this site: pictures need the Premium plan. Drawings are sent as shapes only. https://passback.dev/pricing',
    );
  };
  try {
    win
      .fetch(url, { credentials: 'omit' })
      .then((res) => res.status === 200 && res.json())
      .then((body: unknown) => {
        if ((body as { screenshots?: unknown } | null)?.screenshots === false) turnOff();
      })
      .catch(() => undefined);
  } catch {
    // A probe that cannot start leaves capture on.
  }
  return () => pictures;
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

// An active load cancelled by toggle(false) before it arrives opens nothing.
export function createShotStep(deps: ShotStepDeps): ShotStep {
  const { doc, win, root, host } = deps;
  const { enabled, ...opt } = stepSettings(doc, win, host);
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
        else if (wantOn || preloaded || need)
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

  const holder = createHold(release);
  const close = (): void => (holder.drop(), release());
  const required = (): boolean => pictureRequired(win, enabled, opt);

  host.addEventListener('passback:preload', () => {
    if (!enabled || session || preloaded) return;
    preloaded = true;
    load().catch(() => undefined);
  });

  let submitted: SubmitDetail | undefined;
  host.addEventListener('passback:submit', (event) => {
    submitted = (event as CustomEvent<SubmitDetail>).detail;
  });

  return {
    enabled,
    toggle(on) {
      wantOn = on;
      if (session) session.setActive(on);
      else if (on && enabled) load().catch(() => undefined);
    },
    async finish(element) {
      const detail = submitted?.element === element ? submitted : undefined;
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
