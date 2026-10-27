// the hot bridge gives the widget an import.meta.hot under vite serve.

import type { AddressInfo } from 'node:net';
import { build, createServer, type ViteDevServer } from 'vite';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  HOT_BRIDGE_URL,
  hotBridgeSrc,
  hotBridgeTag,
  loadHotBridge,
  resolveHotBridge,
} from './hot-bridge';
import ensureWidget from './global-setup';
import { passback } from './plugin';
import { cleanupRoot, readAllOutputText, tempRoot, writeProject } from './widget-test-utils';
import { join } from 'node:path';

let server: ViteDevServer | undefined;
let root: string | undefined;

// Run from the repo root, this file gets neither the package's globalSetup nor its VITEST unset.
beforeAll(() => ensureWidget(), 120_000);

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (root) cleanupRoot(root);
  root = undefined;
});

async function startServer(base?: string): Promise<string> {
  root = tempRoot();
  writeProject(root);
  server = await createServer({
    root,
    base,
    plugins: [passback({ buildId: 'abc1234', enableInTests: true })],
    server: { strictPort: false, host: '127.0.0.1' },
    optimizeDeps: { noDiscovery: true },
    logLevel: 'silent',
  });
  await server.listen();
  const address = server.httpServer?.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe('hot bridge', () => {
  it('resolves only the bridge url to a virtual id', () => {
    expect(resolveHotBridge(HOT_BRIDGE_URL)).toBe('\0passback-hot');
    expect(resolveHotBridge('/@passback/widget.js')).toBeUndefined();
    expect(resolveHotBridge('/src/main.tsx')).toBeUndefined();
  });

  it('loads a module that stores import.meta.hot on window.__passback', () => {
    expect(loadHotBridge('\0passback-hot')).toBe(
      "window.__passback = Object.assign(window.__passback || {}, { hot: import.meta.hot, caps: ['reopen', 'list', 'verdict', 'clear'] });",
    );
    expect(loadHotBridge('/src/main.tsx')).toBeUndefined();
  });

  it('lists the reopen and clear capabilities next to the hot object', () => {
    const source = loadHotBridge('\0passback-hot')!;
    const hot = { accept: () => {} };
    const fakeWindow: { __passback?: { hot?: unknown; caps?: string[] } } = {};
    const run = new Function('window', 'hot', source.replaceAll('import.meta.hot', 'hot'));
    run(fakeWindow, hot);
    expect(fakeWindow.__passback?.caps).toEqual(['reopen', 'list', 'verdict', 'clear']);
    expect(fakeWindow.__passback?.hot).toBe(hot);
  });

  it('tags the bridge as a head-prepend module script', () => {
    expect(hotBridgeSrc('/preview/')).toBe('/preview/@passback/hot.js');
    expect(hotBridgeTag('/@passback/hot.js')).toEqual({
      tag: 'script',
      attrs: { type: 'module', src: '/@passback/hot.js' },
      injectTo: 'head-prepend',
    });
  });

  it('a served bridge module carries a hot context and comes before the widget script', async () => {
    for (const base of ['/', '/preview/']) {
      const url = await startServer(base === '/' ? undefined : base);
      const response = await fetch(`${url}${base}@passback/hot.js`);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('import.meta.hot = ');
      expect(body).toContain('window.__passback');

      const html = await (await fetch(`${url}${base}`)).text();
      const hot = html.indexOf(`${base}@passback/hot.js`);
      expect(hot).toBeGreaterThanOrEqual(0);
      expect(hot).toBeLessThan(html.indexOf(`${base}@passback/widget.js`));

      await server?.close();
      server = undefined;
      cleanupRoot(root!);
      root = undefined;
    }
  }, 30000);

  it('a staging build output carries no hot bridge', async () => {
    root = tempRoot();
    writeProject(root);
    await build({
      root,
      mode: 'staging',
      plugins: [passback({ stagingModes: ['staging'], buildId: 'abc1234' })],
      logLevel: 'silent',
      build: { outDir: 'dist' },
    });
    expect(readAllOutputText(join(root, 'dist'))).not.toContain('@passback/hot.js');
  }, 20000);
});
