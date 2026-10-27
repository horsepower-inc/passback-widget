// Real `vite serve` coverage for the widget delivery seam: the dev endpoint, its HTML
// injection, and the actionable failure when the artifact isn't built.

import type { AddressInfo } from 'node:net';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { passback } from './plugin';
import { readChunkArtifact } from './widget-chunk';
import {
  cleanupRoot,
  realWidgetBytes,
  scriptSrcs,
  tempRoot,
  writeProject,
} from './widget-test-utils';

let server: ViteDevServer | undefined;
let root: string | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (root) cleanupRoot(root);
  root = undefined;
});

async function startServer(
  options: Parameters<typeof passback>[0] = {},
  base?: string,
): Promise<{ url: string }> {
  root = tempRoot();
  writeProject(root);
  server = await createServer({
    root,
    base,
    plugins: [passback(options)],
    server: { strictPort: false, host: '127.0.0.1' },
    optimizeDeps: { noDiscovery: true },
    logLevel: 'silent',
  });
  await server.listen();
  const address = server.httpServer?.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}` };
}

describe('widget serve', () => {
  it('serves the real widget artifact as JavaScript', async () => {
    const { url } = await startServer();
    const response = await fetch(`${url}/@passback/widget.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(realWidgetBytes('local'))).toBe(true);
  }, 20000);

  it('injects one module script immediately after the build id', async () => {
    const { url } = await startServer({ buildId: 'abc1234' });
    const html = await (await fetch(url)).text();
    const scripts = scriptSrcs(html);
    expect(scripts.filter((src) => src === '/@passback/widget.js')).toHaveLength(1);
    expect(html.indexOf('window.__passback')).toBeLessThan(html.indexOf('/@passback/widget.js'));
  }, 20000);

  it('serves the widget endpoint with a query string', async () => {
    const { url } = await startServer();
    const response = await fetch(`${url}/@passback/widget.js?t=123`);
    expect(response.status).toBe(200);
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(realWidgetBytes('local'))).toBe(true);
  }, 20000);

  it('returns widget headers without a body for HEAD', async () => {
    const { url } = await startServer();
    const response = await fetch(`${url}/@passback/widget.js`, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  }, 20000);

  it('serves and injects the widget beneath a pathname base', async () => {
    const { url } = await startServer({}, '/preview/');
    const widgetResponse = await fetch(`${url}/preview/@passback/widget.js`);
    expect(widgetResponse.status).toBe(200);
    const html = await (await fetch(`${url}/preview/`)).text();
    expect(scriptSrcs(html)).toContain('/preview/@passback/widget.js');
  }, 20000);

  it('serves the real collector chunk as JavaScript at the collector endpoint', async () => {
    const { url } = await startServer();
    const response = await fetch(`${url}/@passback/collector.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(readChunkArtifact().bytes)).toBe(true);
  }, 20000);

  it('tags the widget script with the collector endpoint', async () => {
    const { url } = await startServer();
    const html = await (await fetch(url)).text();
    expect(html).toMatch(/<script[^>]*data-passback-chunk="\/@passback\/collector\.js"/);
    expect(html.match(/data-passback-chunk=/g)).toHaveLength(1);
  }, 20000);

  it('serves and tags the collector beneath a pathname base', async () => {
    const { url } = await startServer({}, '/preview/');
    const chunkResponse = await fetch(`${url}/preview/@passback/collector.js`);
    expect(chunkResponse.status).toBe(200);
    const html = await (await fetch(`${url}/preview/`)).text();
    expect(html).toContain('data-passback-chunk="/preview/@passback/collector.js"');
  }, 20000);

  it('fails server setup when the widget artifact is unavailable', async () => {
    vi.resetModules();
    vi.doMock('./widget-bundle', () => ({
      readWidgetArtifact: () => {
        throw new Error(
          'passback: cannot find the widget artifact (@passback/widget/dist/passback.js). ' +
            'Run `pnpm --filter @passback/widget build` and retry.',
        );
      },
      createWidgetMiddleware: vi.fn(),
      serveWidgetSrc: (base: string) => `${base}@passback/widget.js`,
      buildWidgetSrc: vi.fn(),
      widgetTag: (src: string) => ({
        tag: 'script',
        attrs: { type: 'module', src },
        injectTo: 'head-prepend',
      }),
      WIDGET_ASSET_NAME: 'widget.js',
    }));
    const failRoot = tempRoot();
    writeProject(failRoot);
    try {
      const { passback: mockedPassback } = await import('./plugin');
      const { createServer: createMockedServer } = await import('vite');
      await expect(
        createMockedServer({
          root: failRoot,
          plugins: [mockedPassback()],
          server: { middlewareMode: true },
          logLevel: 'silent',
        }),
      ).rejects.toThrow(/passback:.*@passback\/widget\/dist\/passback\.js/);
    } finally {
      vi.doUnmock('./widget-bundle');
      vi.resetModules();
      cleanupRoot(failRoot);
    }
  }, 20000);
});
