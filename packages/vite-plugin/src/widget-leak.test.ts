// widget-specific companion to 's leak test — a real,
// nonempty widget artifact proves the staging control, then production and an unlisted custom
// mode are each diffed against a plugin-free control build to catch any unmarked artifact.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { build, type Plugin } from 'vite';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { passback } from './plugin';
import {
  cleanupRoot,
  listOutputFiles,
  readAllOutputText,
  realWidgetBytes,
  scriptSrcs,
  tempRoot,
  writeProject,
} from './widget-test-utils';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) cleanupRoot(root);
});

function relativeOutputFiles(dist: string): string[] {
  return listOutputFiles(dist)
    .map((file) => relative(dist, file).replace(/-.{8}\.js$/, '-HASH.js'))
    .sort();
}

async function buildInto(mode: string, plugins: Plugin[]): Promise<string> {
  const root = tempRoot();
  roots.push(root);
  writeProject(root);
  await build({ root, mode, plugins, logLevel: 'silent', build: { outDir: 'dist', minify: true } });
  return join(root, 'dist');
}

function expectNoPassbackBytes(output: string): void {
  expect(output).not.toContain('data-source');
  expect(output).not.toContain('__passback');
  expect(output).not.toContain('data-passback-host');
  expect(output).not.toContain('/@passback/widget.js');
}

describe('widget leak', () => {
  it('uses a real nonempty widget artifact as the staging control', async () => {
    const dist = await buildInto('staging', [
      passback({ stagingModes: ['staging'], buildId: 'leak001' }),
    ]);
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    const src = scriptSrcs(html).find((s) => s.includes('widget-'));
    expect(src).toBeTruthy();
    const bytes = readFileSync(join(dist, src!.slice(1)));
    expect(bytes.equals(realWidgetBytes())).toBe(true);
    expect(bytes.toString('utf8')).toContain('data-passback-host');
  }, 20000);

  it('adds no Passback bytes or artifacts to a production build', async () => {
    const controlDist = await buildInto('production', []);
    const passbackDist = await buildInto('production', [passback({ stagingModes: ['staging'] })]);

    expect(relativeOutputFiles(passbackDist)).toEqual(relativeOutputFiles(controlDist));
    expectNoPassbackBytes(readAllOutputText(passbackDist));
    expect(existsSync(join(passbackDist, '..', '.passback', 'manifest.json'))).toBe(false);
  }, 20000);

  it('adds no Passback bytes or artifacts to an unlisted mode build', async () => {
    const controlDist = await buildInto('custom', []);
    const passbackDist = await buildInto('custom', [passback({ stagingModes: ['staging'] })]);

    expect(relativeOutputFiles(passbackDist)).toEqual(relativeOutputFiles(controlDist));
    expectNoPassbackBytes(readAllOutputText(passbackDist));
  }, 20000);

  it('does not resolve the widget artifact during inactive builds', async () => {
    vi.resetModules();
    const readWidgetArtifactSpy = vi.fn();
    vi.doMock('./widget-bundle', () => ({
      readWidgetArtifact: readWidgetArtifactSpy,
      createWidgetMiddleware: vi.fn(),
      serveWidgetSrc: vi.fn(),
      buildWidgetSrc: vi.fn(),
      widgetTag: vi.fn(),
      WIDGET_ASSET_NAME: 'widget.js',
    }));
    const root = tempRoot();
    roots.push(root);
    writeProject(root);
    try {
      const { passback: mockedPassback } = await import('./plugin');
      const { build: mockedBuild } = await import('vite');
      await mockedBuild({
        root,
        mode: 'production',
        plugins: [mockedPassback({ stagingModes: ['staging'] })],
        logLevel: 'silent',
        build: { minify: false },
      });
      expect(readWidgetArtifactSpy).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('./widget-bundle');
      vi.resetModules();
    }
  }, 20000);
});
