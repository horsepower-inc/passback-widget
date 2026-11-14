// `@passback/vite-plugin/head`: the inert entry, the pure conversion and serialization, the
// serve-only resolution, and the real dev-server import on whichever Vite is installed.

import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createServer,
  type HtmlTagDescriptor,
  type Plugin,
  type UserConfig,
  type ViteDevServer,
} from 'vite';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import ensureWidgetBuilt from './global-setup';
import { passbackHead, passbackHeadHtml, type PassbackHeadTag } from './head';
import {
  HEAD_IMPORT,
  headModuleSource,
  headTagsHtml,
  keepHeadInSsr,
  toHeadTags,
} from './head-module';
import { passback, type PassbackOptions } from './plugin';
import { cleanupRoot, tempRoot, writeProject } from './widget-test-utils';

type Hook<A extends unknown[], R> = (this: unknown, ...args: A) => R;
type Hooks = {
  config: Hook<[object, { command: string }], unknown>;
  configResolved: Hook<[object], void>;
  resolveId: Hook<[string], unknown>;
  load: Hook<[string], unknown>;
  transformIndexHtml: Hook<[string, { path: string }], HtmlTagDescriptor[]>;
};

function hooks(plugin: Plugin): Hooks {
  return plugin as unknown as Hooks;
}

function resolved(plugin: Plugin, command: 'serve' | 'build'): Hooks {
  const h = hooks(plugin);
  h.configResolved.call({}, { root: process.cwd(), command, base: '/' });
  return h;
}

beforeAll(() => ensureWidgetBuilt(), 120_000);

let server: ViteDevServer | undefined;
let root: string | undefined;

afterEach(async () => {
  try {
    await server?.close();
  } finally {
    server = undefined;
    if (root) cleanupRoot(root);
    root = undefined;
  }
});

// Installs the package as an app would, so the public import is an inert node_modules dependency
// that Vite externalizes during SSR unless the plugin keeps it in the module graph.
function installInertPackage(dir: string): void {
  const pkg = join(dir, 'node_modules', '@passback', 'vite-plugin');
  mkdirSync(pkg, { recursive: true });
  const manifest = {
    name: '@passback/vite-plugin',
    type: 'module',
    exports: { './head': './head.js' },
  };
  writeFileSync(join(pkg, 'package.json'), JSON.stringify(manifest));
  writeFileSync(
    join(pkg, 'head.js'),
    'export const passbackHead = () => [];\nexport const passbackHeadHtml = () => "";\n',
  );
}

// Links the repo's own package into node_modules and keeps the node_modules path, as Vite sees a
// package npm or pnpm installed. Its source export is a .ts file Vite would never externalize, so
// the inert installs above are what fail without the noExternal merge; this case checks the merge
// reaches the server the app runs.
function linkRepoPackage(dir: string): UserConfig {
  const scope = join(dir, 'node_modules', '@passback');
  mkdirSync(scope, { recursive: true });
  const pkg = dirname(dirname(fileURLToPath(import.meta.url)));
  symlinkSync(pkg, join(scope, 'vite-plugin'), 'dir');
  return { resolve: { preserveSymlinks: true } };
}

async function loadHead(
  options: PassbackOptions,
  base?: string,
  install: (dir: string) => UserConfig | void = installInertPackage,
): Promise<{ tags: PassbackHeadTag[]; html: string; plugin: Plugin }> {
  root = tempRoot();
  writeProject(root);
  const extra = install(root) ?? {};
  writeFileSync(
    join(root, 'probe.ts'),
    `import { passbackHead, passbackHeadHtml } from '${HEAD_IMPORT}';\nexport const tags = passbackHead();\nexport const html = passbackHeadHtml();\n`,
  );
  const plugin = passback({ enableInTests: true, ...options });
  server = await createServer({
    root,
    base,
    plugins: [plugin],
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    logLevel: 'silent',
    ...extra,
  });
  const mod = await server.ssrLoadModule('/probe.ts');
  return { tags: mod.tags as PassbackHeadTag[], html: mod.html as string, plugin };
}

function indexTags(plugin: Plugin): PassbackHeadTag[] {
  return toHeadTags(hooks(plugin).transformIndexHtml.call({}, '', { path: '/index.html' }));
}

describe('passback head', () => {
  it('returns empty tags and HTML from the inert head entry', () => {
    expect(passbackHead()).toEqual([]);
    expect(passbackHeadHtml()).toBe('');
    expect(headTagsHtml([])).toBe('');
  });

  it('escapes head attributes and ordinary text while preserving script children', () => {
    const tags: PassbackHeadTag[] = [
      { tag: 'meta', attrs: { content: 'a&b "c" <d>' } },
      { tag: 'script', attrs: { src: '/x.js' }, children: 'if (a < b && "c") {}' },
      { tag: 'script', attrs: {} },
    ];
    expect(headTagsHtml(tags)).toBe(
      '<meta content="a&amp;b &quot;c&quot; &lt;d&gt;">' +
        '<script src="/x.js">if (a < b && "c") {}</script>' +
        '<script></script>',
    );
    const text = { tag: 'meta', attrs: {}, children: 'a<b&c>' } as PassbackHeadTag;
    expect(headTagsHtml([text])).toBe('<meta>');
    const other = { tag: 'style' as 'script', attrs: {}, children: 'a<b&c>' };
    expect(headTagsHtml([other])).toBe('<style>a&lt;b&amp;c&gt;</style>');
  });

  it('converts descriptor attributes to strings and drops boolean attributes', () => {
    const descriptors: HtmlTagDescriptor[] = [
      {
        tag: 'script',
        attrs: { type: 'module', defer: true, async: false, 'data-n': 5 as unknown as string },
        children: 'x',
        injectTo: 'head-prepend',
      },
      { tag: 'meta', injectTo: 'head' },
    ];
    expect(toHeadTags(descriptors)).toEqual([
      { tag: 'script', attrs: { type: 'module', 'data-n': '5' }, children: 'x' },
      { tag: 'meta', attrs: {} },
    ]);
    const source = headModuleSource(toHeadTags(descriptors));
    expect(source).toContain('export function passbackHead()');
    expect(source).toContain('export function passbackHeadHtml()');
  });

  it('resolves only the exact head import during serve', () => {
    const h = resolved(passback({ enableInTests: true }), 'serve');
    const id = h.resolveId.call({}, HEAD_IMPORT);
    expect(id).toBe('\0passback-head');
    expect(h.load.call({}, id as string)).toContain('export function passbackHead()');
    for (const other of [`${HEAD_IMPORT}/`, `${HEAD_IMPORT}.js`, '@passback/vite-plugin']) {
      expect(h.resolveId.call({}, other)).toBeUndefined();
    }
    const config: { ssr?: { noExternal?: unknown } } = {};
    expect(h.config.call({}, config, { command: 'serve' })).toBeUndefined();
    expect(config.ssr?.noExternal).toEqual(['@passback/vite-plugin']);
    const kept = (noExternal: unknown) => {
      const app = { ssr: { noExternal } } as Parameters<typeof keepHeadInSsr>[0];
      keepHeadInSsr(app);
      return app.ssr?.noExternal;
    };
    expect(kept(true)).toBe(true);
    expect(kept('lib')).toEqual(['lib', '@passback/vite-plugin']);
    expect(kept(/^ui-/)).toEqual([/^ui-/, '@passback/vite-plugin']);
    expect(kept(['a', /b/])).toEqual(['a', /b/, '@passback/vite-plugin']);
    expect(kept(['@passback/vite-plugin'])).toEqual(['@passback/vite-plugin']);
    expect(h.resolveId.call({}, '/@passback/hot.js')).toBe('\0passback-hot');
    expect(h.load.call({}, '\0passback-hot')).toContain('window.__passback');
  });

  it('leaves the head import inert during build and when the plugin is inactive', () => {
    const h = resolved(passback({ enableInTests: true }), 'build');
    expect(h.resolveId.call({}, HEAD_IMPORT)).toBeUndefined();
    const config: { ssr?: unknown } = {};
    expect(h.config.call({}, config, { command: 'build' })).toBeUndefined();
    expect(config.ssr).toBeUndefined();
    expect(h.load.call({}, '\0passback-head')).toBeUndefined();
    const apply = (options: PassbackOptions, env: object): boolean =>
      (passback(options).apply as (c: object, e: object) => boolean)({}, env);
    expect(apply({ mode: 'off' }, { command: 'serve', mode: 'development' })).toBe(false);
    expect(apply({ enableInTests: true }, { command: 'build', mode: 'production' })).toBe(false);
    expect(passbackHead()).toEqual([]);
    expect(passbackHeadHtml()).toBe('');
  });

  it('loads agent head tags through the dev server public import', async () => {
    const { tags, html, plugin } = await loadHead({ buildId: 'abc1234' });
    const srcs = tags.map((t) => t.attrs.src).filter(Boolean);
    expect(srcs).toContain('/@passback/hot.js');
    expect(srcs).toContain('/@passback/widget.js');
    expect(tags[0]!.children).toContain('abc1234');
    expect(tags.some((t) => 'data-passback-endpoint' in t.attrs)).toBe(false);
    expect(tags).toEqual(indexTags(plugin));
    expect(html).toBe(headTagsHtml(tags));
  }, 20000);

  it('loads relay head tags through the dev server public import', async () => {
    const { tags, html } = await loadHead({
      mode: 'relay',
      siteKey: 'site 1',
      endpoint: 'https://api.example.com/',
    });
    const widget = tags.find((t) => t.attrs.src === '/@passback/widget.js');
    expect(widget?.attrs['data-passback-endpoint']).toBe(
      'https://api.example.com/v1/ingest/site%201',
    );
    expect(tags.some((t) => t.attrs.src === '/@passback/hot.js')).toBe(false);
    expect(html).toContain('data-passback-endpoint="https://api.example.com/v1/ingest/site%201"');
  }, 20000);

  it('matches index HTML tags for a configured base settings and screenshots', async () => {
    const { tags, html, plugin } = await loadHead(
      { buildId: 'b1', screenshots: true, theme: 'dark', corner: 'top-left' },
      '/app/',
    );
    expect(tags).toEqual(indexTags(plugin));
    expect(html).toBe(headTagsHtml(indexTags(plugin)));
    expect(tags.map((t) => t.attrs.src).filter(Boolean)).toContain('/app/@passback/widget.js');
    const widget = tags.find((t) => t.attrs.src?.endsWith('widget.js'));
    expect(widget?.attrs['data-passback-screenshots']).toBe('true');
    expect(widget?.attrs['data-passback-theme']).toBe('dark');
    expect(widget?.attrs['data-passback-corner']).toBe('top-left');
    expect(widget?.attrs['data-passback-chunk']).toBe('/app/@passback/collector.js');
  }, 20000);

  it('loads head tags when the app imports the entry from an installed package', async () => {
    const { tags, html, plugin } = await loadHead(
      { buildId: 'c0ffee1' },
      undefined,
      linkRepoPackage,
    );
    expect(server?.config.ssr.noExternal).toEqual(['@passback/vite-plugin']);
    expect(tags.map((t) => t.attrs.src)).toContain('/@passback/widget.js');
    expect(tags).toEqual(indexTags(plugin));
    expect(html).toBe(headTagsHtml(tags));
    expect(html).not.toBe('');
  }, 20000);
});
