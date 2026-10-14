import { loadShotOpen, readShotConfig } from './shot-loader';
import { isSandboxShot } from './sandbox-shot';
import type { Drawing } from './overlay-draw';
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
  close(): void;
};

export function shotExtra(outcome: ShotOutcome): ShotOutcome | undefined {
  const { screenshot } = outcome;
  const annotations = outcome.annotations?.length ? outcome.annotations : undefined;
  if (!screenshot && !annotations) return undefined;
  return { ...(screenshot && { screenshot }), ...(annotations && { annotations }) };
}

export function drawingOf(step: ShotStep): { drawing?: Drawing } {
  if (!step.enabled) return {};
  return { drawing: { toggle: (on) => step.toggle(on), cancel: () => step.close() } };
}

async function finishSession(session: ShotSession | null, element: Element): Promise<ShotOutcome> {
  try {
    if (session === null || session.count() === 0) return {};
    return await session.finish(element);
  } catch {
    return { note: 'Screenshot not attached' };
  }
}

function stepSettings(
  doc: Document,
  win: Window,
): { enabled: boolean; uploadUrl: string; local?: boolean } {
  const config = readShotConfig(doc);
  const registered = (win as unknown as { __passback?: { shot?: unknown } }).__passback?.shot;
  // A session enabled through the sandbox alone never uploads.
  return {
    enabled: config.enabled || isSandboxShot(registered),
    uploadUrl: config.enabled ? config.uploadUrl : '',
    local: config.enabled && config.local,
  };
}

function closeQuietly(session: ShotSession | null): void {
  try {
    session?.close();
  } catch {
    // A session that fails to close must not stop the mark from being sent.
  }
}

// An active load cancelled by toggle(false) before it arrives opens nothing.
export function createShotStep(deps: ShotStepDeps): ShotStep {
  const { doc, win, root, host } = deps;
  const { enabled, uploadUrl, local } = stepSettings(doc, win);
  let session: ShotSession | null = null;
  // epoch counts closes (a late load is dropped), wantOn is drawing wanted, preloaded one preload per epoch.
  let [epoch, wantOn, preloaded] = [0, false, false];

  function load(): void {
    const ticket = epoch;
    loadShotOpen(doc, win).then(
      (open) => {
        if (ticket !== epoch) return;
        if (session) session.setActive(wantOn);
        else if (wantOn || preloaded) session = open({ win, root, host, uploadUrl, active: wantOn, local });
      },
      () => {
        if (ticket === epoch && wantOn) deps.onLoadFailed();
      },
    );
  }

  function close(): void {
    epoch++;
    wantOn = preloaded = false;
    const current = session;
    session = null;
    closeQuietly(current);
  }

  host.addEventListener('passback:preload', () => {
    if (!enabled || session || preloaded) return;
    preloaded = true;
    load();
  });

  return {
    enabled,
    toggle(on) {
      wantOn = on;
      if (session) session.setActive(on);
      else if (on && enabled) load();
    },
    async finish(element) {
      const outcome = await finishSession(session, element);
      close();
      return outcome;
    },
    close,
  };
}
