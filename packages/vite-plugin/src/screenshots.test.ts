import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import type { ConfigEnv, HtmlTagDescriptor, IndexHtmlTransformContext, ResolvedConfig } from 'vite';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ensureWidgetBuilt from './global-setup';
// Run from the repo root, vitest skips this package's setupFiles; switch the plugin on here too.
import './unset-vitest';
import { passback } from './plugin';
import { cleanupRoot, tempRoot, writeProject } from './widget-test-utils';

type Options = Parameters<typeof passback>[0];
type ApplyFn = (config: unknown, env: ConfigEnv) => boolean;
type ConfigResolvedFn = (config: ResolvedConfig) => void;
type TransformIndexHtmlFn = (html: string, ctx: IndexHtmlTransformContext) => HtmlTagDescriptor[];
type Attrs = Record<string, string | boolean | undefined>;

const SITE = 'pb_abc';
const API = 'https://api.example.com';
const INGEST = 'https://api.example.com/v1/ingest/pb_abc';
const DEFAULT_INGEST = 'https://api.passback.dev/v1/ingest/pb_abc';
const SHOTS = 'data-passback-screenshots';
const ENDPOINT = 'data-passback-endpoint';
const LOOK = { theme: 'dark', corner: 'top-left' } as const;
const RELAY = { siteKey: SITE, endpoint: API };

const roots: string[] = [];

// Run from the repo root, vitest skips this package's globalSetup; build the widget here too.
beforeAll(() => ensureWidgetBuilt(), 120_000);

afterEach(() => {
  for (const root of roots.splice(0)) cleanupRoot(root);
});

function serveTags(options: Options): Attrs[] {
  const plugin = passback(options);
  const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
  const root = tempRoot();
  roots.push(root);
  configResolved({ root, command: 'serve' } as ResolvedConfig);
  const transform = plugin.transformIndexHtml as unknown as TransformIndexHtmlFn;
  const tags = transform('', {} as IndexHtmlTransformContext);
  return tags.map((tag) => (typeof tag.attrs === 'object' ? tag.attrs : {}));
}

async function buildTags(options: Options, mode = 'production'): Promise<Attrs[]> {
  const root = tempRoot();
  roots.push(root);
  writeProject(root);
  await build({
    root,
    mode,
    plugins: [passback({ buildId: 'abc1234', stagingModes: [mode], ...options })],
    logLevel: 'silent',
    build: { minify: false },
  });
  const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
  return [...html.matchAll(/<script([^>]*)>/g)].map((match) => {
    const attrs: Attrs = {};
    for (const [, name, value] of match[1]!.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      attrs[name!] = value ?? true;
    }
    return attrs;
  });
}

function widget(tags: Attrs[]): Attrs {
  const found = tags.filter((attrs) => attrs['data-passback-chunk'] !== undefined);
  expect(found).toHaveLength(1);
  return found[0]!;
}

function applies(options: Options, command: 'serve' | 'build', mode: string): boolean {
  const apply = passback(options).apply as unknown as ApplyFn;
  return apply({}, { command, mode } as ConfigEnv);
}

describe('screenshots option', () => {
  it('defaults screenshots to true on relay widget tags', async () => {
    const options = { ...RELAY, ...LOOK };
    const cases = [
      widget(serveTags({ ...options, mode: 'relay' })),
      widget(await buildTags({ ...options, mode: 'relay' })),
      widget(await buildTags(options)),
    ];
    for (const tag of cases) {
      expect(tag[SHOTS]).toBe('true');
      expect(tag[ENDPOINT]).toBe(INGEST);
      expect(tag['data-passback-chunk']).toBeDefined();
      expect(tag['data-passback-theme']).toBe('dark');
      expect(tag['data-passback-corner']).toBe('top-left');
    }
  }, 60000);

  it('honors screenshot overrides on widget tags', async () => {
    for (const screenshots of [true, false]) {
      const expected = screenshots ? 'true' : undefined;
      const relay = { ...RELAY, mode: 'relay' as const, screenshots };
      for (const tag of [widget(serveTags(relay)), widget(await buildTags(relay))]) {
        expect(tag[SHOTS]).toBe(expected);
        expect(tag[ENDPOINT]).toBe(INGEST);
      }
      const agent = { stagingModes: ['staging'], screenshots };
      const agentTags = [widget(serveTags(agent)), widget(await buildTags(agent, 'staging'))];
      for (const tag of agentTags) {
        expect(tag[SHOTS]).toBe(expected);
        expect(tag[ENDPOINT]).toBeUndefined();
      }
    }
  }, 60000);

  it('keeps default agent tags unchanged and screenshots off other tags', async () => {
    const hosted = { ...RELAY };
    const serves = [serveTags(hosted), serveTags({ ...hosted, mode: 'agent' })];
    for (const tags of serves) {
      const tag = widget(tags);
      expect(tag[SHOTS]).toBeUndefined();
      expect(tag[ENDPOINT]).toBeUndefined();
      expect(tags.some((attrs) => attrs.src === '/@passback/hot.js')).toBe(true);
    }
    const staging = await buildTags({ stagingModes: ['staging'] }, 'staging');
    expect(widget(staging)[SHOTS]).toBeUndefined();
    expect(widget(staging)[ENDPOINT]).toBeUndefined();

    const withShots = serveTags({ screenshots: true });
    const bridge = withShots.find((attrs) => attrs.src === '/@passback/hot.js');
    expect(bridge).toBeDefined();
    for (const tags of [...serves, staging, withShots]) {
      const others = tags.filter((attrs) => attrs['data-passback-chunk'] === undefined);
      expect(others.every((attrs) => attrs[SHOTS] === undefined)).toBe(true);
    }

    const previous = process.env.VERCEL_GIT_PULL_REQUEST_ID;
    process.env.VERCEL_GIT_PULL_REQUEST_ID = '12';
    try {
      const pr = serveTags({ ...RELAY, mode: 'relay' });
      expect(pr.filter((attrs) => attrs[SHOTS] !== undefined)).toHaveLength(1);
      const built = await buildTags({ ...RELAY, mode: 'relay' });
      const html = built.filter((attrs) => attrs[SHOTS] !== undefined);
      expect(html).toHaveLength(1);
      expect(html[0]).toBe(widget(built));
    } finally {
      if (previous === undefined) delete process.env.VERCEL_GIT_PULL_REQUEST_ID;
      else process.env.VERCEL_GIT_PULL_REQUEST_ID = previous;
    }
  }, 60000);

  it('preserves screenshot options with the default relay endpoint', async () => {
    for (const screenshots of [undefined, true, false]) {
      const expected = screenshots === false ? undefined : 'true';
      const options = {
        siteKey: SITE,
        ...LOOK,
        ...(screenshots === undefined ? {} : { screenshots }),
      };
      const cases = [
        widget(serveTags({ ...options, mode: 'relay' })),
        widget(await buildTags({ ...options, mode: 'relay' })),
        widget(await buildTags(options)),
      ];
      for (const tag of cases) {
        expect(tag[SHOTS]).toBe(expected);
        expect(tag[ENDPOINT]).toBe(DEFAULT_INGEST);
        expect(tag['data-passback-chunk']).toBeDefined();
        expect(tag['data-passback-theme']).toBe('dark');
        expect(tag['data-passback-corner']).toBe('top-left');
      }
    }
  }, 120000);

  it('preserves activation and relay configuration failures with screenshots enabled', async () => {
    const shots = { screenshots: true };
    const off = { ...RELAY, ...shots, mode: 'off' as const };
    expect(applies(off, 'serve', 'development')).toBe(false);
    expect(applies(off, 'build', 'production')).toBe(false);
    expect(applies({ ...RELAY, ...shots, mode: 'agent' }, 'build', 'production')).toBe(false);
    expect(applies({ ...shots }, 'build', 'production')).toBe(false);

    expect(() => passback({ ...shots, mode: 'hosted' as never })).toThrow(
      /passback: mode must be 'agent', 'relay' or 'off'/,
    );
    await expect(buildTags({ ...shots, mode: 'relay', endpoint: API })).rejects.toThrow(
      /passback: mode 'relay' needs siteKey/,
    );
    for (const endpoint of ['', 'not a url']) {
      const options = { ...shots, siteKey: SITE, mode: 'relay' as const, endpoint };
      expect(() => serveTags(options)).toThrow(/passback: siteKey needs endpoint/);
      await expect(buildTags(options)).rejects.toThrow(/passback: siteKey needs endpoint/);
    }
  }, 60000);

  it('adds the local upload url to the agent serve tag only when screenshots is true', async () => {
    const UPLOAD = 'data-passback-shot-upload';
    expect(widget(serveTags({ screenshots: true }))[UPLOAD]).toBe('/@passback/screenshots');
    expect(widget(serveTags({ screenshots: false }))[UPLOAD]).toBeUndefined();
    expect(widget(serveTags({}))[UPLOAD]).toBeUndefined();
    expect(
      widget(serveTags({ ...RELAY, mode: 'relay', screenshots: true }))[UPLOAD],
    ).toBeUndefined();
    const built = await buildTags({ stagingModes: ['staging'], screenshots: true }, 'staging');
    expect(widget(built)[UPLOAD]).toBeUndefined();
  }, 60000);

  it('warns once when an agent build asks for screenshots', () => {
    const plugin = passback({ screenshots: true });
    (plugin.configResolved as unknown as ConfigResolvedFn)({
      root: tempRoot(),
      command: 'build',
    } as ResolvedConfig);
    const warn = vi.fn();
    (plugin.buildStart as unknown as (this: { warn: typeof warn }) => void).call({ warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/dev server/);

    const quiet = passback({ ...RELAY, mode: 'relay', screenshots: true });
    (quiet.configResolved as unknown as ConfigResolvedFn)({
      root: tempRoot(),
      command: 'build',
    } as ResolvedConfig);
    const none = vi.fn();
    (quiet.buildStart as unknown as (this: { warn: typeof none }) => void).call({ warn: none });
    expect(none).not.toHaveBeenCalled();
  });
});
