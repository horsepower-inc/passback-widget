import type { HtmlTagDescriptor, IndexHtmlTransformContext, ResolvedConfig } from 'vite';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import ensureWidgetBuilt from './global-setup';
// Run from the repo root, vitest skips this package's setupFiles; switch the plugin on here too.
import './unset-vitest';
import { relayBesideBridge } from './hosted';
import { passback } from './plugin';
import { cleanupRoot, tempRoot } from './widget-test-utils';

type ConfigResolvedFn = (config: ResolvedConfig) => void;
type TransformIndexHtmlFn = (html: string, ctx: IndexHtmlTransformContext) => HtmlTagDescriptor[];

const SITE = 'pb_abc';
const API = 'https://api.example.com';
const INGEST = 'https://api.example.com/v1/ingest/pb_abc';
const DEFAULT_INGEST = 'https://api.passback.dev/v1/ingest/pb_abc';
const NO_CTX = {} as IndexHtmlTransformContext;
const ENDPOINT = 'data-passback-endpoint';
const PANEL = 'data-passback-panel';
const UPLOAD = 'data-passback-shot-upload';

const roots: string[] = [];

// Run from the repo root, vitest skips this package's globalSetup; build the widget here too.
beforeAll(() => ensureWidgetBuilt(), 120_000);

afterEach(() => {
  for (const root of roots.splice(0)) cleanupRoot(root);
});

function serveTags(options: Parameters<typeof passback>[0]): HtmlTagDescriptor[] {
  const plugin = passback(options);
  const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
  const root = tempRoot();
  roots.push(root);
  configResolved({ root, command: 'serve' } as ResolvedConfig);
  const transformIndexHtml = plugin.transformIndexHtml as unknown as TransformIndexHtmlFn;
  return transformIndexHtml('', NO_CTX);
}

function widget(tags: HtmlTagDescriptor[]): Record<string, unknown> {
  const found = tags.filter((tag) => tag.attrs?.['data-passback-chunk'] !== undefined);
  expect(found).toHaveLength(1);
  return found[0]!.attrs ?? {};
}

function hasBridge(tags: HtmlTagDescriptor[]): boolean {
  return tags.some((tag) => tag.attrs?.src === '/@passback/hot.js');
}

describe('relay beside the bridge on the dev server', () => {
  it('answers true only for a serve with a site key and no mode', () => {
    expect(relayBesideBridge({ siteKey: SITE }, 'serve')).toBe(true);
    expect(relayBesideBridge({ siteKey: SITE }, 'build')).toBe(false);
    expect(relayBesideBridge({ siteKey: SITE, mode: 'agent' }, 'serve')).toBe(false);
    expect(relayBesideBridge({ siteKey: SITE, mode: 'relay' }, 'serve')).toBe(false);
    expect(relayBesideBridge({ siteKey: '  ' }, 'serve')).toBe(false);
    expect(relayBesideBridge({}, 'serve')).toBe(false);
  });

  it('puts the relay endpoint and the local bridge on the dev tags when a site key is given and mode is left out', () => {
    const tags = serveTags({ siteKey: SITE, endpoint: API });
    expect(widget(tags)[ENDPOINT]).toBe(INGEST);
    expect(hasBridge(tags)).toBe(true);
  });

  it('uses the production relay beside the bridge when only a site key is given', () => {
    const tags = serveTags({ siteKey: SITE });
    expect(widget(tags)[ENDPOINT]).toBe(DEFAULT_INGEST);
    expect(hasBridge(tags)).toBe(true);
  });

  it('names the panel chunk on the dev widget tag beside the relay endpoint', () => {
    const attrs = widget(serveTags({ siteKey: SITE }));
    expect(attrs[ENDPOINT]).toBe(DEFAULT_INGEST);
    expect(attrs[PANEL]).toBeDefined();
  });

  it('keeps mode relay on the relay only, with no bridge and no panel chunk', () => {
    const tags = serveTags({ siteKey: SITE, mode: 'relay' });
    expect(widget(tags)[ENDPOINT]).toBe(DEFAULT_INGEST);
    expect(widget(tags)[PANEL]).toBeUndefined();
    expect(hasBridge(tags)).toBe(false);
  });

  it('keeps the local loop without an endpoint when mode is agent or the site key is blank', () => {
    const cases = [
      { siteKey: SITE, mode: 'agent' as const },
      { siteKey: '   ' },
      { siteKey: '' },
      {},
    ];
    for (const options of cases) {
      const tags = serveTags(options);
      expect(widget(tags)[ENDPOINT]).toBeUndefined();
      expect(widget(tags)[PANEL]).toBeDefined();
      expect(hasBridge(tags)).toBe(true);
    }
  });

  it('refuses an explicit invalid endpoint beside a site key on the dev server', () => {
    for (const endpoint of ['', '   ', 'not a url', 'ftp://api.example.com']) {
      expect(() => serveTags({ siteKey: SITE, endpoint })).toThrow(
        /passback: siteKey needs endpoint/,
      );
    }
    expect(() => serveTags({ siteKey: SITE, endpoint: '', mode: 'agent' })).not.toThrow();
  });

  it('sends screenshots to the relay and adds no shot upload address beside the bridge', () => {
    for (const screenshots of [undefined, true]) {
      const options = screenshots === undefined ? {} : { screenshots };
      const attrs = widget(serveTags({ siteKey: SITE, ...options }));
      expect(attrs['data-passback-screenshots']).toBe('true');
      expect(attrs[UPLOAD]).toBeUndefined();
    }
  });
});
