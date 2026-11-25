import type { Payload } from '@passback/schema';
import type { TimelineEvent } from '@passback/schema';
import { collectElement } from './element';
import { collectRects } from './rects';
import { collectStyles } from './styles';
import { collectFlags } from './flags';
import { collectText, type MeasureFont } from './text';
import { collectReactChain } from './react';
import { collectVueChain } from './vue';
import { collectSvelteChain } from './svelte';
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

const TITLE_MAX = 200;
const VERSION_MAX = 80;
const ASSET_MAX = 200;
const ASSET_LIMIT = 8;
const VERSION_META_NAMES = ['version', 'build', 'commit', 'revision'];

function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function pageTitle(doc: Document): string | undefined {
  const title = attempt(() => doc.title);
  return typeof title === 'string' && title !== '' ? title.slice(0, TITLE_MAX) : undefined;
}

function pageAssets(doc: Document, win: Window): string[] | undefined {
  const scripts = attempt(() => Array.from(doc.scripts));
  if (scripts === undefined) return undefined;
  const origin = attempt(() => win.location.origin);
  const base = attempt(() => doc.baseURI);
  const assets: string[] = [];
  for (const script of scripts) {
    if (assets.length >= ASSET_LIMIT) break;
    const path = attempt(() => {
      if (script.hasAttribute('data-passback-chunk')) return undefined;
      if (script.hasAttribute('data-passback-endpoint')) return undefined;
      const src = script.getAttribute('src');
      if (!src) return undefined;
      const url = new URL(src, base);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
      return url.origin === origin ? url.pathname.slice(0, ASSET_MAX) : undefined;
    });
    if (path) assets.push(path);
  }
  return assets.length > 0 ? assets : undefined;
}

function nextBuildId(win: Window): string | undefined {
  const id = attempt(
    () => (win as unknown as { __NEXT_DATA__?: { buildId?: unknown } }).__NEXT_DATA__?.buildId,
  );
  return typeof id === 'string' && id !== '' ? id : undefined;
}

function metaVersion(doc: Document): string | undefined {
  const metas = attempt(() => Array.from(doc.querySelectorAll('meta')));
  if (metas === undefined) return undefined;
  for (const name of VERSION_META_NAMES) {
    for (const meta of metas) {
      const content = attempt(() =>
        meta.getAttribute('name') === name ? meta.getAttribute('content') : undefined,
      );
      if (typeof content === 'string' && content !== '') return content;
    }
  }
  return undefined;
}

function appVersion(doc: Document, win: Window): string | undefined {
  const version = nextBuildId(win) ?? metaVersion(doc);
  return version === undefined ? undefined : version.slice(0, VERSION_MAX);
}

// Svelte is read when React and Vue give no chain, e.g. an unnamed Vue root hosting a Svelte app.
function frameworkChain(el: Element): Pick<Payload['code'], 'framework' | 'chain'> {
  const react = collectReactChain(el);
  const vue = react.framework === 'unknown' ? collectVueChain(el) : react;
  if (vue.chain.length > 0) return vue;
  const svelte = collectSvelteChain(el);
  return svelte.framework === 'unknown' ? vue : svelte;
}

export function assemblePayload(input: AssembleInput): Payload {
  const { el, comment, win, timeline, getters, measure } = input;

  const id = buildId(win);
  const doc = attempt(() => win.document);
  const title = doc && pageTitle(doc);
  const assets = doc && pageAssets(doc, win);
  const version = appVersion(doc ?? ({} as Document), win);
  const chain = frameworkChain(el);
  const code = {
    ...chain,
    ...(id === undefined ? {} : { buildId: id }),
    ...(version === undefined ? {} : { appVersion: version }),
    ...(assets === undefined ? {} : { assets }),
  };

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
    runtime: {
      ...collectRuntime(el, win, getters),
      ...(title === undefined ? {} : { title }),
    },
    timeline,
    environment: collectEnvironment(win),
    intent: { comment, annotations: [] },
  };
}
