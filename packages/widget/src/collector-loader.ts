export type ScriptConfig = { chunkSrc?: string; endpoint?: string };

type WithChunks = { __passback?: Record<string, unknown> };

const loads = new WeakMap<Document, Map<string, Promise<unknown>>>();

// The CDN serves the collector chunk under this name next to the widget script, like the Next route and the Vite plugin do.
const CHUNK_FILE = 'collector.js';

export function besideScript(
  file: string,
  script: Element | null,
  doc: Document,
): string | undefined {
  const src = script?.getAttribute('src');
  if (!src) return undefined;
  try {
    return new URL(file, new URL(src, doc.baseURI)).href;
  } catch {
    return undefined;
  }
}

export function readScriptConfig(doc: Document): ScriptConfig {
  const script = doc.querySelector('script[data-passback-chunk], script[data-passback-endpoint]');
  const config: ScriptConfig = {};
  const chunkSrc =
    script?.getAttribute('data-passback-chunk') || besideScript(CHUNK_FILE, script, doc);
  const endpoint = script?.getAttribute('data-passback-endpoint');
  if (chunkSrc) config.chunkSrc = chunkSrc;
  if (endpoint) config.endpoint = endpoint;
  return config;
}

/** Loads a lazy chunk once per document and key, and resolves with what it registered under the key on window.__passback. */
export function loadRegistered<T>(
  doc: Document,
  win: Window,
  key: string,
  name: string,
  source: () => string,
): Promise<T> {
  const registered = (): T | undefined => {
    const made = (win as unknown as WithChunks).__passback?.[key];
    return typeof made === 'function' ? (made as T) : undefined;
  };
  const ready = registered();
  if (ready) return Promise.resolve(ready);
  const pending = loads.get(doc) ?? new Map<string, Promise<unknown>>();
  loads.set(doc, pending);
  const known = pending.get(key) as Promise<T> | undefined;
  if (known) return known;
  // After the two checks above: a load in flight is answered even if its script tag has gone since.
  const load = new Promise<T>((resolve, reject) => {
    const src = source();
    const script = doc.createElement('script');
    script.async = true;
    script.src = src;
    script.addEventListener('load', () => {
      const made = registered();
      if (made) resolve(made);
      else reject(new Error(`passback: the ${name} chunk loaded but registered nothing`));
    });
    script.addEventListener('error', () => {
      reject(new Error(`passback: cannot load the ${name} chunk (${src})`));
    });
    doc.head.appendChild(script);
  });
  pending.set(key, load);
  load.catch(() => {
    if (pending.get(key) === load) pending.delete(key);
  });
  return load;
}
export function loadCollectFactory<T>(doc: Document, win: Window): Promise<T> {
  return loadRegistered(doc, win, 'collect', 'collector', () => {
    const { chunkSrc } = readScriptConfig(doc);
    if (!chunkSrc) throw new Error('passback: the widget script has no data-passback-chunk');
    return chunkSrc;
  });
}
