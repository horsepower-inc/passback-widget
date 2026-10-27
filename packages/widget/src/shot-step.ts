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

// An active load cancelled by toggle(false) before it arrives opens nothing.
export function createShotStep(deps: ShotStepDeps): ShotStep {
  const { doc, win, root, host } = deps;
  const { enabled, ...opt } = stepSettings(doc, win, host);
  let bound: FlowCtx | undefined; // the overlay context, once its first dispatch has run
  let session: ShotSession | undefined;
  // epoch counts closes (a late load is dropped), wantOn is drawing wanted, preloaded one preload per epoch.
  let [epoch, wantOn, preloaded] = [0, false, false];

  function load(): void {
    const ticket = epoch;
    loadShotOpen(doc, win).then(
      (open) => {
        if (ticket !== epoch) return;
        if (session) session.setActive(wantOn);
        else if (wantOn || preloaded) session = open({ win, root, host, ...opt, active: wantOn });
        session?.bind?.(bound!);
      },
      () => {
        if (ticket === epoch && wantOn) deps.onLoadFailed();
      },
    );
  }

  function close(): void {
    epoch++;
    wantOn = preloaded = false;
    try {
      session?.close();
    } catch {
      // A session that fails to close must not stop the mark from being sent.
    }
    session = undefined;
  }

  host.addEventListener('passback:preload', () => {
    if (!enabled || session || preloaded) return;
    preloaded = true;
    load();
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
      else if (on && enabled) load();
    },
    async finish(element) {
      const detail = submitted?.element === element ? submitted : undefined;
      const outcome = await finishSession(session, element, detail);
      close();
      return outcome;
    },
    async finishAll(details) {
      const outcomes: ShotOutcome[] = [];
      for (const detail of details)
        outcomes.push(await finishSession(session, detail.element, detail, outcomes.length));
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
