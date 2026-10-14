import type { CollectFactory } from './collect';

export type ScriptConfig = { chunkSrc?: string; endpoint?: string };

type WithCollect = { __passback?: { collect?: unknown } };

// The CDN serves the collector chunk under this name next to the widget script, like the Next route and the Vite plugin do.
const CHUNK_FILE = 'collector.js';

const loads = new WeakMap<Document, Promise<CollectFactory>>();

function chunkBesideScript(script: Element | null, doc: Document): string | undefined {
  const src = script?.getAttribute('src');
  if (!src) return undefined;
  try {
    return new URL(CHUNK_FILE, new URL(src, doc.baseURI)).href;
  } catch {
    return undefined;
  }
}

export function readScriptConfig(doc: Document): ScriptConfig {
  const script = doc.querySelector('script[data-passback-chunk], script[data-passback-endpoint]');
  const config: ScriptConfig = {};
  const chunkSrc = script?.getAttribute('data-passback-chunk') || chunkBesideScript(script, doc);
  const endpoint = script?.getAttribute('data-passback-endpoint');
  if (chunkSrc) config.chunkSrc = chunkSrc;
  if (endpoint) config.endpoint = endpoint;
  return config;
}

function registered(win: Window): CollectFactory | undefined {
  const collect = (win as unknown as WithCollect).__passback?.collect;
  return typeof collect === 'function' ? (collect as CollectFactory) : undefined;
}

export function loadCollectFactory(doc: Document, win: Window): Promise<CollectFactory> {
  const ready = registered(win);
  if (ready) return Promise.resolve(ready);
  const pending = loads.get(doc);
  if (pending) return pending;
  const { chunkSrc } = readScriptConfig(doc);
  if (!chunkSrc) {
    return Promise.reject(new Error('passback: the widget script has no data-passback-chunk'));
  }
  const load = new Promise<CollectFactory>((resolve, reject) => {
    const script = doc.createElement('script');
    script.async = true;
    script.src = chunkSrc;
    script.addEventListener('load', () => {
      const factory = registered(win);
      if (factory) resolve(factory);
      else reject(new Error('passback: the collector chunk loaded but registered nothing'));
    });
    script.addEventListener('error', () => {
      reject(new Error(`passback: cannot load the collector chunk (${chunkSrc})`));
    });
    doc.head.appendChild(script);
  });
  loads.set(doc, load);
  load.catch(() => {
    if (loads.get(doc) === load) loads.delete(doc);
  });
  return load;
}
