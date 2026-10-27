// `@passback/vite-plugin/head` in a staging build: real Vite SSR builds name the emitted widget
// assets in the module's tags, and replaceAssetTokens swaps the tokens in every output chunk.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, type Rollup } from 'vite';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ensureWidgetBuilt from './global-setup';
import type { PassbackHeadTag } from './head';
import { COLLECTOR_TOKEN, replaceAssetTokens, SHOT_TOKEN, WIDGET_TOKEN } from './head-build';
import { HEAD_IMPORT, headTagsHtml } from './head-module';
import { passback, type PassbackOptions } from './plugin';
import { cleanupRoot, tempRoot } from './widget-test-utils';

beforeAll(() => ensureWidgetBuilt(), 120_000);

let root: string | undefined;

beforeEach(() => {
  vi.stubEnv('VERCEL_GIT_PULL_REQUEST_ID', '42');
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (root) cleanupRoot(root);
  root = undefined;
});

type Built = { dist: string; code: string; tags: PassbackHeadTag[]; html: string };

const RELAY: PassbackOptions = {
  mode: 'relay',
  siteKey: 'site-1',
  endpoint: 'https://api.example.com',
  enableInTests: true,
  stagingModes: ['production'],
  buildId: 'abc1234',
  theme: 'dark',
  corner: 'top-left',
};

const INACTIVE_ALIAS = join(dirname(fileURLToPath(import.meta.url)), 'head.ts');

async function buildSsr(
  options: PassbackOptions,
  config: { base?: string; alias?: boolean } = {},
): Promise<Built> {
  root = tempRoot();
  writeFileSync(
    join(root, 'entry.ts'),
    `import { passbackHead, passbackHeadHtml } from '${HEAD_IMPORT}';\nexport const tags = passbackHead();\nexport const html = passbackHeadHtml();\n`,
  );
  await build({
    root,
    base: config.base,
    mode: 'production',
    plugins: [passback({ ...RELAY, ...options })],
    resolve: config.alias ? { alias: { [HEAD_IMPORT]: INACTIVE_ALIAS } } : undefined,
    logLevel: 'silent',
    build: { ssr: join(root, 'entry.ts'), ssrEmitAssets: true, minify: false },
  });
  const dist = join(root, 'dist');
  const entry = readdirSync(dist).find((name) => /^entry\.m?js$/.test(name))!;
  const code = readFileSync(join(dist, entry), 'utf8');
  const mod = (await import(/* @vite-ignore */ pathToFileURL(join(dist, entry)).href)) as {
    tags: PassbackHeadTag[];
    html: string;
  };
  return { dist, code, tags: mod.tags, html: mod.html };
}

function srcs(tags: PassbackHeadTag[]): string[] {
  return tags.map((tag) => tag.attrs.src).filter((src): src is string => src !== undefined);
}

describe('passback head in a staging build', () => {
  it('renders SSR head with emitted relay assets', async () => {
    const { dist, code, tags, html } = await buildSsr({});
    expect(code).toMatch(/\/assets\/widget-[\w-]+\.js/);
    expect(code).not.toContain('__PASSBACK_ASSET_');
    const widget = tags.find((tag) => tag.attrs.src?.includes('/assets/widget-'))!;
    expect(widget.attrs['data-passback-endpoint']).toBe('https://api.example.com/v1/ingest/site-1');
    expect(widget.attrs['data-passback-theme']).toBe('dark');
    expect(widget.attrs['data-passback-corner']).toBe('top-left');
    expect(widget.attrs['data-passback-screenshots']).toBe('true');
    expect(widget.attrs['data-passback-chunk']).toMatch(/^\/assets\/collector-[\w-]+\.js$/);
    expect(widget.attrs['data-passback-shot']).toMatch(/^\/assets\/shot-[\w-]+\.js$/);
    const scripts = tags.map((tag) => tag.children ?? '').join('\n');
    expect(scripts).toContain('abc1234');
    expect(scripts).toContain('"42"');
    expect(html).toBe(headTagsHtml(tags));
    expect(html).toContain(widget.attrs.src!);
    const refs = [widget.attrs.src!, widget.attrs['data-passback-chunk']!];
    refs.push(widget.attrs['data-passback-shot']!);
    for (const ref of refs) expect(existsSync(join(dist, ref))).toBe(true);
  }, 60000);

  it('uses root asset URLs for relative SSR bases', async () => {
    for (const base of ['./', '']) {
      const { dist, tags } = await buildSsr({}, { base });
      const widget = tags.find((tag) => tag.attrs.src?.includes('widget-'))!;
      const refs = [widget.attrs.src!, widget.attrs['data-passback-chunk']!];
      refs.push(widget.attrs['data-passback-shot']!);
      for (const ref of refs) {
        expect(ref.startsWith('/assets/')).toBe(true);
        expect(existsSync(join(dist, ref))).toBe(true);
      }
      cleanupRoot(root!);
    }
  }, 60000);

  it('renders empty SSR head when staging is inactive', async () => {
    const { tags, html } = await buildSsr({ stagingModes: [] }, { alias: true });
    expect(tags).toEqual([]);
    expect(html).toBe('');
  }, 60000);

  it('replaces repeated asset tokens in every output chunk', () => {
    const asset = { type: 'asset', source: `${WIDGET_TOKEN}${SHOT_TOKEN}` };
    const chunk = (code: string) => ({ type: 'chunk', code });
    const bundle = {
      'a.js': chunk(`${WIDGET_TOKEN} ${WIDGET_TOKEN} ${COLLECTOR_TOKEN}`),
      'b.js': chunk(`"${SHOT_TOKEN}" "${SHOT_TOKEN}" ${WIDGET_TOKEN}`),
      'c.css': asset,
    } as unknown as Rollup.OutputBundle;
    replaceAssetTokens(bundle, {
      widgetFile: 'assets/widget-1.js',
      chunkFile: 'assets/collector-2.js',
      shotFile: 'assets/shot-3.js',
    });
    const code = (name: string) => (bundle[name] as Rollup.OutputChunk).code;
    expect(code('a.js')).toBe('assets/widget-1.js assets/widget-1.js assets/collector-2.js');
    expect(code('b.js')).toBe('"assets/shot-3.js" "assets/shot-3.js" assets/widget-1.js');
    expect((bundle['c.css'] as unknown as typeof asset).source).toBe(asset.source);
    replaceAssetTokens(bundle, { widgetFile: 'x', chunkFile: 'y' });
    expect(code('a.js')).not.toContain('__PASSBACK_ASSET_');
  });

  it('omits shot assets from SSR head when screenshots are disabled', async () => {
    const { dist, code, tags } = await buildSsr({ screenshots: false });
    expect(code).not.toContain('shot');
    expect(code).not.toContain('__PASSBACK_ASSET_');
    expect(tags.some((tag) => 'data-passback-shot' in tag.attrs)).toBe(false);
    expect(srcs(tags).some((src) => src.includes('shot'))).toBe(false);
    const files = readdirSync(join(dist, 'assets'));
    expect(files.some((name) => name.startsWith('shot'))).toBe(false);
    expect(files.some((name) => name.startsWith('widget-'))).toBe(true);
  }, 60000);
});
