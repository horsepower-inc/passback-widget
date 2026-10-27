// `passback snapshot`: opens each route at each viewport and writes one rect snapshot file.

import type { RectSnapshot, SnapshotFile } from '@passback/collectors/geometry';
import { collectPageRects } from './snapshot-page';

export type PageLike = {
  goto(url: string, opts: { waitUntil: 'load' }): Promise<{ ok(): boolean } | null>;
  addStyleTag(opts: { content: string }): Promise<unknown>;
  evaluate<T>(fn: string | (() => T)): Promise<T>;
};
export type ContextLike = {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
};
export type BrowserLike = {
  newContext(opts: {
    viewport: { width: number; height: number };
    reducedMotion: 'reduce';
  }): Promise<ContextLike>;
  close(): Promise<void>;
};
export type PlaywrightLike = {
  chromium: { launch(): Promise<BrowserLike> };
};

type Io = { out(line: string): void; err(line: string): void };
type Deps = {
  load(): Promise<PlaywrightLike>;
  write(path: string, text: string): Promise<void>;
};
type Opts = { url: string; routes: string[]; viewports: number[]; out: string };

const HEIGHT = 800;
const NO_ANIMATION =
  '*, *::before, *::after { animation: none !important; transition: none !important; }';

export async function loadPlaywright(): Promise<PlaywrightLike> {
  const name = 'playwright';
  return (await import(name)) as PlaywrightLike;
}

async function openPage(
  context: ContextLike,
  url: string,
  route: string,
): Promise<PageLike | null> {
  const page = await context.newPage();
  try {
    const response = await page.goto(new URL(route, url).href, { waitUntil: 'load' });
    if (response !== null && !response.ok()) return null;
  } catch {
    return null;
  }
  return page;
}

async function measure(page: PageLike): Promise<RectSnapshot['rects']> {
  await page.addStyleTag({ content: NO_ANIMATION });
  await page.evaluate('document.fonts.ready.then(() => true)');
  return page.evaluate(collectPageRects);
}

async function snapshotOne(
  browser: BrowserLike,
  opts: Opts,
  route: string,
  width: number,
): Promise<RectSnapshot | null> {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT },
    reducedMotion: 'reduce',
  });
  try {
    const page = await openPage(context, opts.url, route);
    if (page === null) return null;
    return { v: 1, route, viewport: [width, HEIGHT], rects: await measure(page) };
  } finally {
    await context.close();
  }
}

async function collectAll(
  browser: BrowserLike,
  opts: Opts,
  io: Io,
): Promise<RectSnapshot[] | null> {
  const snapshots: RectSnapshot[] = [];
  for (const route of opts.routes) {
    for (const width of opts.viewports) {
      const snapshot = await snapshotOne(browser, opts, route, width);
      if (snapshot === null) {
        io.err('passback snapshot: cannot load ' + route + ' at ' + width);
        return null;
      }
      snapshots.push(snapshot);
    }
  }
  return snapshots;
}

export async function runSnapshot(opts: Opts, deps: Deps, io: Io): Promise<number> {
  let playwright: PlaywrightLike;
  try {
    playwright = await deps.load();
  } catch {
    io.err('passback snapshot needs Playwright: npm i -D playwright');
    return 2;
  }
  const browser = await playwright.chromium.launch();
  try {
    const snapshots = await collectAll(browser, opts, io);
    if (snapshots === null) return 1;
    const file: SnapshotFile = { v: 1, snapshots };
    await deps.write(opts.out, JSON.stringify(file, null, 2) + '\n');
    io.out('wrote ' + opts.out);
    return 0;
  } finally {
    await browser.close();
  }
}
