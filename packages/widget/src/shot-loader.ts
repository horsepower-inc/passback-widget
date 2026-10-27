import type { Screenshot, Annotation } from '@passback/schema';
import type { FlowCtx } from './overlay-draw';
import type { SubmitDetail } from './overlay-submit';

export type ShotOutcome = { screenshot?: Screenshot; annotations?: Annotation[]; note?: string };
export type ShotSession = {
  setActive(on: boolean): void;
  count(): number;
  finish(
    element: Element,
    detail?: SubmitDetail,
    opts?: { picture?: boolean },
  ): Promise<ShotOutcome>;
  close(): void;
  bind?(ctx: FlowCtx): void;
};
export type ShotOpenOptions = {
  win: Window;
  root: ShadowRoot;
  host: HTMLElement;
  uploadUrl: string;
  fetchFn?: typeof fetch;
  active?: boolean;
  local?: boolean;
  capture?: () => boolean;
};
export type ShotOpen = (opts: ShotOpenOptions) => ShotSession;
export type ShotConfig =
  { enabled: false } | { enabled: true; src: string; uploadUrl: string; local?: true };

type WithShot = { __passback?: { shot?: unknown } };
const loads = new WeakMap<Document, Promise<ShotOpen>>();
// The CDN serves the shot chunk under this name next to the widget script.
const SHOT_FILE = 'shot.js';

function besideScript(script: Element, doc: Document): string | undefined {
  const src = script.getAttribute('src');
  if (!src) return undefined;
  try {
    return new URL(SHOT_FILE, new URL(src, doc.baseURI)).href;
  } catch {
    return undefined;
  }
}

export function readShotConfig(doc: Document): ShotConfig {
  const scripts = doc.querySelectorAll('script[data-passback-screenshots="true"]');
  for (const script of scripts) {
    const src = script.getAttribute('data-passback-shot') || besideScript(script, doc);
    const endpoint = script.getAttribute('data-passback-endpoint');
    if (src && endpoint) {
      return { enabled: true, src, uploadUrl: `${endpoint.replace(/\/+$/, '')}/screenshots` };
    }
  }
  // Local mode: no endpoint, the dev server names its own upload route.
  for (const script of scripts) {
    const src = script.getAttribute('data-passback-shot') || besideScript(script, doc);
    const upload = script.getAttribute('data-passback-shot-upload');
    if (src && upload && !script.getAttribute('data-passback-endpoint')) {
      return { enabled: true, src, uploadUrl: upload, local: true };
    }
  }
  return { enabled: false };
}

function registered(win: Window): ShotOpen | undefined {
  const shot = (win as unknown as WithShot).__passback?.shot;
  return typeof shot === 'function' ? (shot as ShotOpen) : undefined;
}

export function loadShotOpen(doc: Document, win: Window): Promise<ShotOpen> {
  const ready = registered(win);
  if (ready) return Promise.resolve(ready);
  const pending = loads.get(doc);
  if (pending) return pending;
  const config = readShotConfig(doc);
  if (!config.enabled) {
    return Promise.reject(new Error('passback: screenshots are not enabled on the widget script'));
  }
  const load = new Promise<ShotOpen>((resolve, reject) => {
    const script = doc.createElement('script');
    script.async = true;
    script.src = config.src;
    script.addEventListener('load', () => {
      const open = registered(win);
      if (open) resolve(open);
      else reject(new Error('passback: the shot chunk loaded but registered nothing'));
    });
    script.addEventListener('error', () => {
      reject(new Error(`passback: cannot load the shot chunk (${config.src})`));
    });
    doc.head.appendChild(script);
  });
  loads.set(doc, load);
  load.catch(() => {
    if (loads.get(doc) === load) loads.delete(doc);
  });
  return load;
}
