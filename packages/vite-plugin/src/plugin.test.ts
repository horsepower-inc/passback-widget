import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, createServer, type HtmlTagDescriptor, type ResolvedConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import type { injectSource } from './inject';
import { passback } from './plugin';
import { tempRoot } from './widget-test-utils';

type TransformResult = ReturnType<typeof injectSource>;
type TransformFn = (code: string, id: string) => TransformResult;
type ConfigResolvedFn = (config: ResolvedConfig) => void;

function transformerFor(root: string, options?: Parameters<typeof passback>[0]): TransformFn {
  const plugin = passback(options);
  const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
  configResolved({ root } as ResolvedConfig);
  return plugin.transform as unknown as TransformFn;
}

type IndexHtmlFn = (html: string, ctx: { path: string }) => HtmlTagDescriptor[];

function serveTags(options: Parameters<typeof passback>[0]): HtmlTagDescriptor[] {
  const plugin = passback(options);
  const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
  configResolved({ root: '/repo', command: 'serve', base: '/' } as ResolvedConfig);
  return (plugin.transformIndexHtml as unknown as IndexHtmlFn)('', { path: '/index.html' });
}

function widgetTagOf(tags: HtmlTagDescriptor[]): HtmlTagDescriptor {
  return tags.find(
    (tag) => (tag.attrs as Record<string, unknown> | undefined)?.src === '/@passback/widget.js',
  )!;
}

describe('passback', () => {
  it('injects data-source into a tsx module served by the dev server', async () => {
    const root = tempRoot('passback-');
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'src', 'App.tsx'),
      'export function App() {\n  return <div>Hi</div>;\n}\n',
    );

    const server = await createServer({
      root,
      plugins: [passback()],
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true },
      logLevel: 'silent',
    });
    try {
      const result = await server.transformRequest('/src/App.tsx');
      expect(result?.code).toMatch(/"data-source": "src\/App\.tsx:\d+:\d+"/);
    } finally {
      await server.close();
    }
  }, 20000);

  it('maps the served module back to its own source file', async () => {
    const root = tempRoot('passback-');
    mkdirSync(join(root, 'src'));
    const source = 'export function App() {\n  return <div>Hi</div>;\n}\n';
    writeFileSync(join(root, 'src', 'App.tsx'), source);

    const server = await createServer({
      root,
      plugins: [passback()],
      server: { middlewareMode: true },
      optimizeDeps: { noDiscovery: true },
      logLevel: 'silent',
    });
    try {
      const result = await server.transformRequest('/src/App.tsx');
      const map = result?.map as { sources: string[]; sourcesContent: string[] } | undefined;
      expect(map?.sources).toEqual(['App.tsx']);
      expect(map?.sourcesContent?.[0]).toBe(source);
    } finally {
      await server.close();
    }
  }, 20000);

  it('leaves a module under node_modules unchanged', () => {
    const transform = transformerFor('/repo');
    const result = transform('<div />;', '/repo/node_modules/pkg/src/App.tsx');
    expect(result).toBeNull();
  });

  it('leaves a .ts module unchanged', () => {
    const transform = transformerFor('/repo');
    const result = transform('<div />;', '/repo/src/App.ts');
    expect(result).toBeNull();
  });

  it('strips the query string before reading the extension', () => {
    const transform = transformerFor('/repo');
    const result = transform('<div />;', '/repo/src/App.tsx?t=1700000000000');
    expect(result?.code).toContain('data-source');
  });

  it('uses a path relative to the Vite root with forward slashes', () => {
    const transform = transformerFor('/repo');
    const result = transform('<div />;', '/repo/src/components/App.tsx');
    expect(result?.code).toContain('data-source={"src/components/App.tsx:1:1"}');
  });

  it('names data-source relative to the root option', () => {
    const tmp = tempRoot('passback-');
    const transform = transformerFor(join(tmp, 'apps', 'admin'), { root: '../..' });
    const result = transform('<div />;', join(tmp, 'apps', 'admin', 'src', 'App.tsx'));
    expect(result?.code).toContain('data-source={"apps/admin/src/App.tsx:');
  });

  it('resolves the root option against the Vite root and exposes it through api.root', () => {
    const plugin = passback({ root: '../..' });
    const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
    configResolved({ root: '/repo/apps/admin' } as ResolvedConfig);
    const api = plugin.api as { root: () => string };
    expect(api.root()).toBe('/repo');
  });

  it('skips a file outside the Vite root', () => {
    const transform = transformerFor('/repo');
    const result = transform('<div />;', '/other/src/App.tsx');
    expect(result).toBeNull();
  });

  it('applies through isActive with the stagingModes option', () => {
    const apply = passback({ stagingModes: ['staging'] }).apply as (
      config: unknown,
      env: { command: 'build' | 'serve'; mode: string },
    ) => boolean;
    expect(apply(undefined, { command: 'build', mode: 'staging' })).toBe(true);
    expect(apply(undefined, { command: 'build', mode: 'production' })).toBe(false);
  });

  it('writes the look settings as data-passback attributes on the widget script tag', () => {
    const tags = serveTags({
      buildId: 'b1',
      theme: 'dark',
      corner: 'top-left',
      launcher: 'hidden',
      hotkey: 'Ctrl+Shift+K',
      main: '#2563EB',
      secondary: '#1e293b',
    });
    const attrs = widgetTagOf(tags).attrs as Record<string, unknown>;
    expect(attrs['data-passback-theme']).toBe('dark');
    expect(attrs['data-passback-corner']).toBe('top-left');
    expect(attrs['data-passback-launcher']).toBe('hidden');
    expect(attrs['data-passback-hotkey']).toBe('ctrl+shift+k');
    expect(attrs['data-passback-main']).toBe('#2563eb');
    expect(attrs['data-passback-secondary']).toBe('#1e293b');
    expect(attrs['data-passback-chunk']).toBe('/@passback/collector.js');
  });

  it('adds no look attribute when no setting is given', () => {
    const attrs = widgetTagOf(serveTags({ buildId: 'b1' })).attrs as Record<string, unknown>;
    const extra = Object.keys(attrs).filter(
      (name) => name.startsWith('data-passback-') && name !== 'data-passback-chunk',
    );
    expect(extra).toEqual([]);
  });

  it('puts the look settings on no other tag', () => {
    const tags = serveTags({ buildId: 'b1', theme: 'dark' });
    const others = tags.filter((tag) => tag !== widgetTagOf(tags));
    expect(others.length).toBeGreaterThan(0);
    for (const tag of others) {
      expect(JSON.stringify(tag.attrs ?? {})).not.toContain('data-passback-theme');
    }
  });

  it('throws a plain message when passback() gets a setting the widget cannot read', () => {
    expect(() => passback({ corner: 'middle' } as never)).toThrow(
      'passback: corner must be bottom-right, bottom-left, top-right or top-left, got "middle"',
    );
    expect(() => passback({ hotkey: 'shift+m' })).toThrow('passback: hotkey must be');
  });

  it('runs before the other transforms', () => {
    expect(passback().enforce).toBe('pre');
  });

  it('produces zero passback bytes in a default production build', async () => {
    const root = tempRoot('passback-');
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'index.html'),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
    );
    writeFileSync(join(root, 'src', 'main.tsx'), 'console.log(<div>Hi</div>);\n');

    await build({
      root,
      mode: 'production',
      plugins: [passback()],
      logLevel: 'silent',
      build: { minify: false },
    });

    const assetsDir = join(root, 'dist', 'assets');
    const bundle = readdirSync(assetsDir)
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(assetsDir, name), 'utf8'))
      .join('\n');
    const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');

    expect(bundle).not.toContain('data-source');
    expect(html).not.toContain('__passback');
    expect(existsSync(join(root, '.passback', 'manifest.json'))).toBe(false);
  }, 20000);

  it('retains hashed data-source markers and writes the manifest in a listed staging build', async () => {
    const root = tempRoot('passback-');
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'index.html'),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
    );
    writeFileSync(join(root, 'src', 'main.tsx'), 'console.log(<div>Hi</div>);\n');

    await build({
      root,
      mode: 'staging',
      plugins: [passback({ buildId: 'abc1234', stagingModes: ['staging'] })],
      logLevel: 'silent',
      build: { minify: false },
    });

    const assetsDir = join(root, 'dist', 'assets');
    const bundle = readdirSync(assetsDir)
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(assetsDir, name), 'utf8'))
      .join('\n');
    const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');

    expect(bundle).toMatch(/"data-source": ?"[0-9a-f]{8}"/);
    expect(html).toContain('window.__passback');
    const manifest = JSON.parse(readFileSync(join(root, '.passback', 'manifest.json'), 'utf8'));
    expect(Object.keys(manifest.abc1234).length).toBeGreaterThan(0);
  }, 20000);
});
