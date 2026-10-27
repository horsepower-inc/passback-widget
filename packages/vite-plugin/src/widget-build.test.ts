// Real `vite build` coverage for an active staging build: one emitted hashed widget asset,
// referenced correctly across bases and nested HTML entries.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { passback } from './plugin';
import { readChunkArtifact } from './widget-chunk';
import {
  cleanupRoot,
  realWidgetBytes,
  scriptSrcs,
  tempRoot,
  writeHtmlEntry,
  writeMainModule,
  writeProject,
} from './widget-test-utils';

let root: string | undefined;

afterEach(() => {
  if (root) cleanupRoot(root);
  root = undefined;
});

async function buildProject(
  opts: { base?: string; buildOptions?: Record<string, unknown>; buildId?: string } = {},
): Promise<string> {
  root = tempRoot();
  writeProject(root);
  await build({
    root,
    base: opts.base,
    mode: 'staging',
    plugins: [passback({ stagingModes: ['staging'], buildId: opts.buildId ?? 'abc1234' })],
    logLevel: 'silent',
    build: { minify: false, ...opts.buildOptions },
  });
  return join(root, 'dist');
}

function widgetSrc(html: string): string {
  const src = scriptSrcs(html).find((s) => s.includes('widget-'));
  if (!src) throw new Error('no widget script tag found');
  return src;
}

describe('widget build', () => {
  it('references one emitted hashed widget asset from staging HTML', async () => {
    const dist = await buildProject();
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    const src = widgetSrc(html);
    expect(src).toMatch(/^\/assets\/widget-.+\.js$/);
    expect(scriptSrcs(html).filter((s) => s.includes('widget-'))).toHaveLength(1);
    const asset = readFileSync(join(dist, src.slice(1)));
    expect(asset.equals(realWidgetBytes())).toBe(true);
  }, 20000);

  it('keeps the build id before the staging widget script', async () => {
    const dist = await buildProject();
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    expect(html.indexOf('window.__passback')).toBeGreaterThan(-1);
    expect(html.indexOf('window.__passback')).toBeLessThan(html.indexOf(widgetSrc(html)));
  }, 20000);

  it('resolves staging widget URLs for root pathname and relative bases', async () => {
    const rootDist = await buildProject({ base: '/' });
    expect(widgetSrc(readFileSync(join(rootDist, 'index.html'), 'utf8'))).toMatch(
      /^\/assets\/widget-.+\.js$/,
    );

    const previewDist = await buildProject({ base: '/preview/' });
    expect(widgetSrc(readFileSync(join(previewDist, 'index.html'), 'utf8'))).toMatch(
      /^\/preview\/assets\/widget-.+\.js$/,
    );

    const relativeDist = await buildProject({ base: './' });
    expect(widgetSrc(readFileSync(join(relativeDist, 'index.html'), 'utf8'))).toMatch(
      /^\.\/assets\/widget-.+\.js$/,
    );
  }, 30000);

  it('shares one widget asset across nested HTML entries', async () => {
    root = tempRoot();
    writeHtmlEntry(root, 'index.html', '/src/main.tsx');
    writeHtmlEntry(root, 'nested/page.html', '/src/main.tsx');
    writeMainModule(root);
    await build({
      root,
      mode: 'staging',
      plugins: [passback({ stagingModes: ['staging'] })],
      logLevel: 'silent',
      build: {
        minify: false,
        rollupOptions: {
          input: { main: join(root, 'index.html'), nested: join(root, 'nested/page.html') },
        },
      },
    });
    const dist = join(root, 'dist');
    const mainSrc = widgetSrc(readFileSync(join(dist, 'index.html'), 'utf8'));
    const nestedSrc = widgetSrc(readFileSync(join(dist, 'nested', 'page.html'), 'utf8'));
    expect(nestedSrc).toBe(mainSrc);
    expect(readFileSync(join(dist, mainSrc.slice(1))).equals(realWidgetBytes())).toBe(true);
  }, 20000);

  it('honors the configured assets directory', async () => {
    const dist = await buildProject({ buildOptions: { assetsDir: 'static' } });
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    const src = widgetSrc(html);
    expect(src).toMatch(/^\/static\/widget-.+\.js$/);
    expect(readFileSync(join(dist, src.slice(1))).equals(realWidgetBytes())).toBe(true);
  }, 20000);

  it('emits one hashed collector asset with the real chunk bytes', async () => {
    const dist = await buildProject();
    const files = readdirSync(join(dist, 'assets')).filter((f) => /^collector-.+\.js$/.test(f));
    expect(files).toHaveLength(1);
    const asset = readFileSync(join(dist, 'assets', files[0]!));
    expect(asset.equals(readChunkArtifact().bytes)).toBe(true);
  }, 20000);

  it('points data-passback-chunk of the staging widget script at the emitted collector asset', async () => {
    const dist = await buildProject({ base: '/preview/' });
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    const match = /data-passback-chunk="([^"]+)"/.exec(html);
    expect(match?.[1]).toMatch(/^\/preview\/assets\/collector-.+\.js$/);
    const file = match![1]!.slice('/preview/'.length);
    expect(readFileSync(join(dist, file)).equals(readChunkArtifact().bytes)).toBe(true);
  }, 20000);

  it('fails an active build when the widget artifact is unavailable', async () => {
    vi.resetModules();
    vi.doMock('./widget-bundle', () => ({
      readWidgetArtifact: () => {
        throw new Error(
          'passback: cannot find the widget artifact (@passback/widget/dist/passback.js). ' +
            'Run `pnpm --filter @passback/widget build` and retry.',
        );
      },
      createWidgetMiddleware: vi.fn(),
      serveWidgetSrc: vi.fn(),
      buildWidgetSrc: vi.fn(),
      widgetTag: vi.fn(() => ({ tag: 'script' })),
      WIDGET_ASSET_NAME: 'widget.js',
    }));
    const failRoot = tempRoot();
    writeProject(failRoot);
    try {
      const { passback: mockedPassback } = await import('./plugin');
      const { build: mockedBuild } = await import('vite');
      await expect(
        mockedBuild({
          root: failRoot,
          mode: 'staging',
          plugins: [mockedPassback({ stagingModes: ['staging'] })],
          logLevel: 'silent',
          build: { minify: false },
        }),
      ).rejects.toThrow(/passback:.*@passback\/widget\/dist\/passback\.js/);
    } finally {
      vi.doUnmock('./widget-bundle');
      vi.resetModules();
      cleanupRoot(failRoot);
    }
  }, 20000);
});
