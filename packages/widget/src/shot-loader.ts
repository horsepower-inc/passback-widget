import type { Screenshot, Annotation } from '@passback/schema';
import { besideScript, loadRegistered } from './collector-loader';
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

// The CDN serves the shot chunk under this name next to the widget script.
const SHOT_FILE = 'shot.js';

export function readShotConfig(doc: Document): ShotConfig {
  const scripts = doc.querySelectorAll('script[data-passback-screenshots="true"]');
  for (const script of scripts) {
    const src = script.getAttribute('data-passback-shot') || besideScript(SHOT_FILE, script, doc);
    const endpoint = script.getAttribute('data-passback-endpoint');
    if (src && endpoint) {
      return { enabled: true, src, uploadUrl: `${endpoint.replace(/\/+$/, '')}/screenshots` };
    }
  }
  // Local mode: no endpoint, the dev server names its own upload route.
  for (const script of scripts) {
    const src = script.getAttribute('data-passback-shot') || besideScript(SHOT_FILE, script, doc);
    const upload = script.getAttribute('data-passback-shot-upload');
    if (src && upload && !script.getAttribute('data-passback-endpoint')) {
      return { enabled: true, src, uploadUrl: upload, local: true };
    }
  }
  return { enabled: false };
}

export function loadShotOpen(doc: Document, win: Window): Promise<ShotOpen> {
  return loadRegistered(doc, win, 'shot', 'shot', () => {
    const config = readShotConfig(doc);
    if (!config.enabled) {
      throw new Error('passback: screenshots are not enabled on the widget script');
    }
    return config.src;
  });
}
