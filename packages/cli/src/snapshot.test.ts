import { parseSnapshotFile } from '@passback/collectors/geometry';
import { describe, expect, it } from 'vitest';
import { runSnapshot, type PlaywrightLike } from './snapshot';

const RECTS = { hero: { x: 0, y: 0, width: 100, height: 50 } };

function setup(failUrl?: string) {
  const calls: string[] = [];
  const contexts: unknown[] = [];
  const fake: PlaywrightLike = {
    chromium: {
      async launch() {
        calls.push('launch');
        return {
          async newContext(o) {
            contexts.push(o);
            return {
              async newPage() {
                let current = '';
                return {
                  async goto(url) {
                    current = url;
                    calls.push('goto ' + url);
                    if (url === failUrl) return { ok: () => false };
                    return null;
                  },
                  async addStyleTag(o2) {
                    calls.push('style ' + o2.content);
                  },
                  async evaluate<T>(fn: string | (() => T)): Promise<T> {
                    if (typeof fn === 'string') {
                      calls.push('eval ' + fn);
                      return true as T;
                    }
                    calls.push('collect ' + current);
                    return RECTS as T;
                  },
                };
              },
              async close() {},
            };
          },
          async close() {
            calls.push('close');
          },
        };
      },
    },
  };
  const written: Array<[string, string]> = [];
  const out: string[] = [];
  const err: string[] = [];
  const deps = {
    load: async () => fake,
    write: async (p: string, t: string) => {
      written.push([p, t]);
    },
  };
  const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
  return { calls, contexts, written, out, err, deps, io };
}

const opts = {
  url: 'http://localhost:3000',
  routes: ['/', '/about'],
  viewports: [375, 1280],
  out: 's.json',
};

describe('runSnapshot', () => {
  it('writes one snapshot per route and viewport', async () => {
    const s = setup();
    expect(await runSnapshot(opts, s.deps, s.io)).toBe(0);
    expect(s.out).toEqual(['wrote s.json']);
    const file = parseSnapshotFile(s.written[0]![1]);
    expect(file.snapshots.map((x) => [x.route, x.viewport])).toEqual([
      ['/', [375, 800]],
      ['/', [1280, 800]],
      ['/about', [375, 800]],
      ['/about', [1280, 800]],
    ]);
    expect(file.snapshots[0]!.rects).toEqual(RECTS);
    expect(s.calls.at(-1)).toBe('close');
  });

  it('injects the animation-off style and awaits fonts before collecting', async () => {
    const s = setup();
    await runSnapshot({ ...opts, routes: ['/'], viewports: [375] }, s.deps, s.io);
    expect(s.calls.slice(1)).toEqual([
      'goto http://localhost:3000/',
      'style *, *::before, *::after { animation: none !important; transition: none !important; }',
      'eval document.fonts.ready.then(() => true)',
      'collect http://localhost:3000/',
      'close',
    ]);
  });

  it('opens each viewport with height 800 and reduced motion', async () => {
    const s = setup();
    await runSnapshot({ ...opts, routes: ['/'] }, s.deps, s.io);
    expect(s.contexts).toEqual([
      { viewport: { width: 375, height: 800 }, reducedMotion: 'reduce' },
      { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' },
    ]);
  });

  it('exits 2 with the install hint when playwright is missing', async () => {
    const s = setup();
    const deps = {
      ...s.deps,
      load: async (): Promise<PlaywrightLike> => {
        throw new Error('Cannot find package');
      },
    };
    expect(await runSnapshot(opts, deps, s.io)).toBe(2);
    expect(s.err).toEqual(['passback snapshot needs Playwright: npm i -D playwright']);
    expect(s.calls).toEqual([]);
    expect(s.written).toEqual([]);
  });

  it('exits 1 naming the route and viewport and writes nothing when a page fails to load', async () => {
    const s = setup('http://localhost:3000/about');
    expect(await runSnapshot(opts, s.deps, s.io)).toBe(1);
    expect(s.err).toEqual(['passback snapshot: cannot load /about at 375']);
    expect(s.written).toEqual([]);
    expect(s.calls.at(-1)).toBe('close');
  });
});
