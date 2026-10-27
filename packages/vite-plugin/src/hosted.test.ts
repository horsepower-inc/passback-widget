import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import type { ConfigEnv, HtmlTagDescriptor, IndexHtmlTransformContext, ResolvedConfig } from 'vite';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ensureWidgetBuilt from './global-setup';
// Run from the repo root, vitest skips this package's setupFiles; switch the plugin on here too.
import './unset-vitest';
import { hostedEndpoint, resolveMode } from './hosted';
import { passback } from './plugin';
import { cleanupRoot, tempRoot, writeProject } from './widget-test-utils';

type ApplyFn = (config: unknown, env: ConfigEnv) => boolean;
type ConfigResolvedFn = (config: ResolvedConfig) => void;
type TransformIndexHtmlFn = (html: string, ctx: IndexHtmlTransformContext) => HtmlTagDescriptor[];

const SITE = 'pb_abc';
const API = 'https://api.example.com';
const INGEST = 'https://api.example.com/v1/ingest/pb_abc';
const DEFAULT_INGEST = 'https://api.passback.dev/v1/ingest/pb_abc';
const NO_CTX = {} as IndexHtmlTransformContext;

let root: string | undefined;

// Run from the repo root, vitest skips this package's globalSetup; build the widget here too.
beforeAll(() => ensureWidgetBuilt(), 120_000);

afterEach(() => {
  if (root) cleanupRoot(root);
  root = undefined;
});

function applies(
  options: Parameters<typeof passback>[0],
  command: 'serve' | 'build',
  mode: string,
): boolean {
  const apply = passback(options).apply as unknown as ApplyFn;
  return apply({}, { command, mode } as ConfigEnv);
}

function serveTags(options: Parameters<typeof passback>[0]): HtmlTagDescriptor[] {
  const plugin = passback(options);
  const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
  configResolved({ root: tempRoot(), command: 'serve' } as ResolvedConfig);
  const transformIndexHtml = plugin.transformIndexHtml as unknown as TransformIndexHtmlFn;
  return transformIndexHtml('', NO_CTX);
}

function buildWith(options: Parameters<typeof passback>[0]): Promise<unknown> {
  root = tempRoot();
  writeProject(root);
  return build({
    root,
    mode: 'production',
    plugins: [passback({ buildId: 'abc1234', ...options })],
    logLevel: 'silent',
    build: { minify: false },
  });
}

describe('hosted options', () => {
  it('builds the ingest address from the endpoint and the site key', () => {
    expect(hostedEndpoint({ siteKey: SITE, endpoint: `${API}/` })).toBe(INGEST);
    expect(hostedEndpoint({ siteKey: `  ${SITE} `, endpoint: `  ${API}/  ` })).toBe(INGEST);
  });

  it('refuses relay without a site key', () => {
    expect(() => hostedEndpoint({ endpoint: API })).toThrow(/passback: mode 'relay' needs siteKey/);
    expect(() => hostedEndpoint({ siteKey: '   ', endpoint: API })).toThrow(
      /passback: mode 'relay' needs siteKey/,
    );
  });

  it('defaults an undefined endpoint to the production relay', () => {
    expect(hostedEndpoint({ siteKey: SITE })).toBe(DEFAULT_INGEST);
    expect(hostedEndpoint({ siteKey: SITE, endpoint: undefined })).toBe(DEFAULT_INGEST);
    expect(hostedEndpoint({ siteKey: `  ${SITE} ` })).toBe(DEFAULT_INGEST);
    expect(hostedEndpoint({ siteKey: 'pb a/b' })).toBe(
      'https://api.passback.dev/v1/ingest/pb%20a%2Fb',
    );
  });

  it('rejects explicitly invalid relay endpoints', () => {
    for (const endpoint of ['', '   ', 'not a url', 'ftp://api.example.com']) {
      expect(() => hostedEndpoint({ siteKey: SITE, endpoint })).toThrow(
        /passback: siteKey needs endpoint/,
      );
    }
  });

  it('picks the agent on the dev server and the relay in a build with a site key when mode is left out', () => {
    const options = { siteKey: SITE, endpoint: API };
    expect(resolveMode(options, 'serve')).toBe('agent');
    expect(resolveMode(options, 'build')).toBe('relay');
    expect(resolveMode({}, 'build')).toBe('agent');
    expect(resolveMode({ siteKey: ' ' }, 'build')).toBe('agent');
  });

  it('rejects a mode it does not know', () => {
    expect(() => passback({ mode: 'hosted' as never })).toThrow(
      /passback: mode must be 'agent', 'relay' or 'off'/,
    );
    for (const mode of ['agent', 'relay', 'off'] as const) {
      expect(() => passback({ mode })).not.toThrow();
    }
  });

  it('applies to a production build when a site key is given', () => {
    const options = { siteKey: SITE, endpoint: API };
    expect(applies(options, 'build', 'production')).toBe(false);
    expect(applies({ ...options, stagingModes: ['production'] }, 'build', 'production')).toBe(true);
    expect(applies({ siteKey: ' ' }, 'build', 'production')).toBe(false);
  });

  it('leaves a relay build out when its mode is not in stagingModes', async () => {
    await buildWith({ mode: 'relay', stagingModes: ['staging'], siteKey: SITE, endpoint: API });
    const html = readFileSync(join(root!, 'dist', 'index.html'), 'utf8');
    expect(html).not.toContain(SITE);
    expect(html).not.toContain('data-passback-endpoint');
  }, 20000);

  it('warns at build time when relay is outside stagingModes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const options = { mode: 'relay' as const, siteKey: SITE, endpoint: API };
      expect(applies(options, 'build', 'production')).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/stagingModes/);
    } finally {
      warn.mockRestore();
    }
  });

  it('puts the ingest address on the widget script of a production build', async () => {
    await buildWith({ siteKey: SITE, endpoint: API, stagingModes: ['production'] });
    const html = readFileSync(join(root!, 'dist', 'index.html'), 'utf8');
    expect(html).toContain(`data-passback-endpoint="${INGEST}"`);
    expect(html).toContain('data-passback-chunk');
  }, 20000);

  it('uses the default relay endpoint through Vite serve and build', async () => {
    const relayTags = serveTags({ siteKey: SITE, mode: 'relay' });
    expect(relayTags.some((tag) => tag.attrs?.['data-passback-endpoint'] === DEFAULT_INGEST)).toBe(
      true,
    );
    expect(relayTags.some((tag) => tag.attrs?.src === '/@passback/hot.js')).toBe(false);

    const agentTags = serveTags({ siteKey: SITE });
    expect(agentTags.some((tag) => tag.attrs?.['data-passback-endpoint'] !== undefined)).toBe(
      false,
    );
    expect(agentTags.some((tag) => tag.attrs?.src === '/@passback/hot.js')).toBe(true);

    await buildWith({ siteKey: SITE, stagingModes: ['production'] });
    const built = readFileSync(join(root!, 'dist', 'index.html'), 'utf8');
    expect(built).toContain(`data-passback-endpoint="${DEFAULT_INGEST}"`);
    expect(built).toContain('data-passback-chunk');
    cleanupRoot(root!);

    expect(applies({ siteKey: SITE }, 'build', 'production')).toBe(false);
    await buildWith({ mode: 'relay', stagingModes: ['staging'], siteKey: SITE });
    const excluded = readFileSync(join(root!, 'dist', 'index.html'), 'utf8');
    expect(excluded).not.toContain(SITE);
    expect(excluded).not.toContain('data-passback-endpoint');
  }, 40000);

  it('leaves the widget out of a build when mode is agent or off', () => {
    const base = { siteKey: SITE, endpoint: API };
    expect(applies({ ...base, mode: 'agent' }, 'build', 'production')).toBe(false);
    expect(applies({ ...base, mode: 'off' }, 'build', 'production')).toBe(false);
    const staging = { ...base, stagingModes: ['staging'] };
    expect(applies({ ...staging, mode: 'agent' }, 'build', 'staging')).toBe(true);
    expect(applies({ ...staging, mode: 'off' }, 'build', 'staging')).toBe(false);
    expect(applies({ ...base, mode: 'off' }, 'serve', 'development')).toBe(false);
  });

  it('keeps the dev server on the local loop when a site key is given', () => {
    const tags = serveTags({ siteKey: SITE, endpoint: API });
    expect(tags.some((tag) => tag.attrs?.['data-passback-endpoint'] !== undefined)).toBe(false);
    expect(tags.some((tag) => tag.attrs?.src === '/@passback/hot.js')).toBe(true);
  });

  it('sends comments from the dev server to the relay when mode is relay', () => {
    const tags = serveTags({ siteKey: SITE, endpoint: API, mode: 'relay' });
    expect(tags.some((tag) => tag.attrs?.['data-passback-endpoint'] === INGEST)).toBe(true);
    expect(tags.some((tag) => tag.attrs?.src === '/@passback/hot.js')).toBe(false);
  });
});
