import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hotShimSource } from './hot-shim';
import { Passback } from './passback';

function children(element: ReactElement | null): ReactElement[] {
  if (element === null) throw new Error('expected an element');
  return (element.props as { children: ReactElement[] }).children;
}

function shimHtml(element: ReactElement): string {
  return (element.props as { dangerouslySetInnerHTML: { __html: string } }).dangerouslySetInnerHTML
    .__html;
}

function stub(vars: Record<string, string>): void {
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
}

const DEV_OFF = { PASSBACK_MODE: '', PASSBACK_BASE_PATH: '', VERCEL_GIT_PULL_REQUEST_ID: '' };

describe('Passback', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('renders null when PASSBACK_MODE is unset', () => {
    vi.stubEnv('PASSBACK_MODE', '');
    expect(Passback()).toBeNull();
  });

  it('renders the hot shim script before the widget script when PASSBACK_MODE is set', () => {
    stub({ PASSBACK_MODE: 'dev', PASSBACK_BASE_PATH: '', PASSBACK_BUILD_ID: 'b1' });
    const [shim, widget] = children(Passback());
    expect(shim?.type).toBe('script');
    expect(shimHtml(shim as ReactElement)).toBe(hotShimSource('', 'b1'));
    expect((widget?.props as { src: string }).src).toBeDefined();
  });

  it('points the widget script at widget.js and names collector.js in data-passback-chunk', () => {
    stub({ PASSBACK_MODE: 'dev', PASSBACK_BASE_PATH: '' });
    const widget = children(Passback())[1] as ReactElement;
    expect(widget.props).toMatchObject({
      async: true,
      src: '/api/passback/widget.js',
      'data-passback-chunk': '/api/passback/collector.js',
    });
  });

  it('prefixes both URLs and the shim with PASSBACK_BASE_PATH', () => {
    stub({ PASSBACK_MODE: 'dev', PASSBACK_BASE_PATH: '/docs', PASSBACK_BUILD_ID: '' });
    const [shim, widget] = children(Passback()) as [ReactElement, ReactElement];
    expect(widget.props).toMatchObject({
      src: '/docs/api/passback/widget.js',
      'data-passback-chunk': '/docs/api/passback/collector.js',
    });
    expect(shimHtml(shim)).toBe(hotShimSource('/docs', ''));
  });

  it('passes PASSBACK_BUILD_ID to the shim', () => {
    stub({ PASSBACK_MODE: 'dev', PASSBACK_BASE_PATH: '', PASSBACK_BUILD_ID: 'build-42' });
    const shim = children(Passback())[0] as ReactElement;
    expect(shimHtml(shim)).toBe(hotShimSource('', 'build-42'));
    expect(shimHtml(shim)).not.toBe(hotShimSource('', 'other'));
  });

  const ENDPOINT = 'https://api.example.com';
  const INGEST = ENDPOINT + '/v1/ingest/pb_abc';
  const hosted = () => Passback({ siteKey: 'pb_abc', endpoint: ENDPOINT });

  it('renders the widget script with the hosted ingest address when a site key is given outside next dev', () => {
    stub({ PASSBACK_MODE: '', PASSBACK_BASE_PATH: '' });
    const script = Passback({ siteKey: 'pb_abc', endpoint: ENDPOINT }) as ReactElement;
    expect(script.type).toBe('script');
    expect(script.props).toMatchObject({
      async: true,
      src: '/api/passback/widget.js',
      'data-passback-chunk': '/api/passback/collector.js',
      'data-passback-endpoint': INGEST,
    });
  });

  it('keeps the local loop in next dev when a site key is given and mode is agent', () => {
    stub({ PASSBACK_MODE: 'dev', PASSBACK_BASE_PATH: '' });
    const [shim, widget] = children(
      Passback({ siteKey: 'pb_abc', endpoint: ENDPOINT, mode: 'agent' }),
    ) as [ReactElement, ReactElement];
    expect(shim.type).toBe('script');
    expect(widget.props).not.toHaveProperty('data-passback-endpoint');
  });

  it('renders null outside next dev when the site key is blank', () => {
    vi.stubEnv('PASSBACK_MODE', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(Passback({ siteKey: '   ', endpoint: ENDPOINT })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('renders null outside next dev when mode is agent or off', () => {
    vi.stubEnv('PASSBACK_MODE', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const site = { siteKey: 'pb_abc', endpoint: ENDPOINT };
    expect(Passback({ ...site, mode: 'agent' })).toBeNull();
    expect(Passback({ ...site, mode: 'off' })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    vi.stubEnv('PASSBACK_MODE', 'dev');
    expect(Passback({ ...site, mode: 'off' })).toBeNull();
    const [shim, widget] = children(Passback({ ...site, mode: 'agent' })) as [
      ReactElement,
      ReactElement,
    ];
    expect(shim.type).toBe('script');
    expect((widget.props as { src: string }).src).toContain('widget.js');
  });

  it('renders the relay script in next dev when mode is relay', () => {
    stub({ PASSBACK_MODE: 'dev', PASSBACK_BASE_PATH: '' });
    const script = Passback({ siteKey: 'pb_abc', endpoint: ENDPOINT, mode: 'relay' });
    expect(script).toMatchObject({ type: 'script', props: { 'data-passback-endpoint': INGEST } });
  });

  it('warns and renders null for explicit invalid endpoints or a missing relay site key', () => {
    vi.stubEnv('PASSBACK_MODE', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(Passback({ siteKey: 'pb_abc', endpoint: '   ' })).toBeNull();
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('siteKey needs endpoint'));
    expect(Passback({ siteKey: 'pb_abc', endpoint: 'ftp://api.example.com' })).toBeNull();
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('siteKey needs endpoint'));
    expect(Passback({ endpoint: ENDPOINT, mode: 'relay' })).toBeNull();
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining("mode 'relay' needs siteKey"));
  });

  const SEED = (n: number) =>
    `try{sessionStorage.getItem("passback:pr")||sessionStorage.setItem("passback:pr","${n}")}catch(e){}`;

  function runSeed(html: string, storage: unknown): void {
    new Function('sessionStorage', html)(storage);
  }

  function memoryStorage(initial?: string) {
    const map = new Map<string, string>();
    if (initial !== undefined) map.set('passback:pr', initial);
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  }

  it('seeds the tab with the Vercel pull request number before the hosted widget script', () => {
    stub({ PASSBACK_MODE: '', PASSBACK_BASE_PATH: '', VERCEL_GIT_PULL_REQUEST_ID: '104' });
    const [seed, widget] = children(hosted()) as [ReactElement, ReactElement];
    expect(seed.type).toBe('script');
    expect(shimHtml(seed)).toBe(SEED(104));
    expect(widget.props).toMatchObject({ 'data-passback-endpoint': INGEST });
  });

  it('reads REVIEW_ID only on a Netlify deploy preview', () => {
    stub({ ...DEV_OFF, REVIEW_ID: '7', CONTEXT: 'deploy-preview' });
    const [seed] = children(hosted()) as [ReactElement, ReactElement];
    expect(shimHtml(seed)).toBe(SEED(7));
    vi.stubEnv('CONTEXT', 'production');
    expect(hosted()).toMatchObject({ type: 'script', props: { 'data-passback-endpoint': INGEST } });
  });

  it('ignores an empty, zero, signed or non-numeric pull request value', () => {
    stub({ PASSBACK_MODE: '', PASSBACK_BASE_PATH: '' });
    for (const value of ['', '0', '012', '-3', 'abc', '1234567890']) {
      vi.stubEnv('VERCEL_GIT_PULL_REQUEST_ID', value);
      expect(hosted()).toMatchObject({
        type: 'script',
        props: { 'data-passback-endpoint': INGEST },
      });
    }
  });

  const HOSTED_ENV = { ...DEV_OFF, PASSBACK_REVIEW_ID: '', CONTEXT: '', REVIEW_ID: '' };

  it('puts the inlined base path in front of the hosted widget urls', () => {
    stub({ ...HOSTED_ENV, PASSBACK_BASE_PATH: '/docs' });
    expect((hosted() as ReactElement).props).toMatchObject({
      src: '/docs/api/passback/widget.js',
      'data-passback-chunk': '/docs/api/passback/collector.js',
    });
  });

  it('seeds the tab with the pull request number withPassback inlined', () => {
    stub({ ...HOSTED_ENV, PASSBACK_REVIEW_ID: '42' });
    expect(shimHtml(children(hosted())[0] as ReactElement)).toBe(SEED(42));
  });

  it('prefers the pull request number read at render time over the inlined one', () => {
    stub({ ...HOSTED_ENV, VERCEL_GIT_PULL_REQUEST_ID: '104', PASSBACK_REVIEW_ID: '42' });
    expect(shimHtml(children(hosted())[0] as ReactElement)).toBe(SEED(104));
  });

  it('ignores an inlined value that is not a pull request number', () => {
    stub({ ...HOSTED_ENV, PASSBACK_REVIEW_ID: 'abc' });
    expect((hosted() as ReactElement).type).toBe('script');
  });

  it('keeps the tab number when the tab already has one', () => {
    stub({ PASSBACK_MODE: '', VERCEL_GIT_PULL_REQUEST_ID: '104' });
    const html = shimHtml(children(hosted())[0] as ReactElement);
    const empty = memoryStorage();
    runSeed(html, empty);
    expect(empty.map.get('passback:pr')).toBe('104');
    const kept = memoryStorage('7');
    runSeed(html, kept);
    expect(kept.map.get('passback:pr')).toBe('7');
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => runSeed(html, throwing)).not.toThrow();
  });

  it('adds no pull request script in next dev', () => {
    stub({ PASSBACK_MODE: 'dev', PASSBACK_BASE_PATH: '', VERCEL_GIT_PULL_REQUEST_ID: '104' });
    for (const child of children(Passback({ siteKey: 'pb_abc', endpoint: ENDPOINT }))) {
      const html = (child.props as { dangerouslySetInnerHTML?: { __html: string } })
        .dangerouslySetInnerHTML?.__html;
      expect(html ?? '').not.toContain('passback:pr');
    }
    vi.stubEnv('PASSBACK_MODE', '');
    expect(Passback({ siteKey: 'pb_abc', endpoint: ENDPOINT, mode: 'agent' })).toBeNull();
  });

  it('throws a plain message on a mode it does not know', () => {
    for (const mode of ['dev', '']) {
      vi.stubEnv('PASSBACK_MODE', mode);
      expect(() => Passback({ mode: 'hosted' } as never)).toThrow(
        "mode must be 'agent', 'relay' or 'off'",
      );
    }
  });
  const CORNER_MESSAGE =
    'passback: corner must be bottom-right, bottom-left, top-right or top-left, got "middle"';
  const dataNames = (el: ReactElement) =>
    Object.keys(el.props as object).filter((k) => k.startsWith('data-passback-'));

  it('writes the look settings as data-passback attributes on the widget script', () => {
    stub({ PASSBACK_MODE: 'dev', PASSBACK_BASE_PATH: '' });
    const look = { theme: 'dark', corner: 'top-left', launcher: 'hidden' } as const;
    const colours = { hotkey: 'Ctrl+Shift+K', main: '#2563EB', secondary: '#1e293b' };
    const widget = children(Passback({ ...look, ...colours }))[1] as ReactElement;
    expect(widget.props).toMatchObject({
      'data-passback-theme': 'dark',
      'data-passback-corner': 'top-left',
      'data-passback-launcher': 'hidden',
      'data-passback-hotkey': 'ctrl+shift+k',
      'data-passback-main': '#2563eb',
      'data-passback-secondary': '#1e293b',
      'data-passback-chunk': '/api/passback/collector.js',
    });
  });

  it('adds no look attribute when no setting is given', () => {
    vi.stubEnv('PASSBACK_MODE', 'dev');
    expect(dataNames(children(Passback())[1] as ReactElement)).toEqual(['data-passback-chunk']);
  });

  it('keeps the look settings off the hot shim script', () => {
    vi.stubEnv('PASSBACK_MODE', 'dev');
    const shim = children(Passback({ theme: 'dark', corner: 'top-left' }))[0] as ReactElement;
    expect(dataNames(shim)).toEqual([]);
  });

  it('throws a plain message on a setting the widget cannot read', () => {
    vi.stubEnv('PASSBACK_MODE', 'dev');
    expect(() => Passback({ corner: 'middle' } as never)).toThrow(CORNER_MESSAGE);
  });

  it('checks no setting when PASSBACK_MODE is unset', () => {
    vi.stubEnv('PASSBACK_MODE', '');
    expect(Passback({ corner: 'middle' } as never)).toBeNull();
  });

  it('writes the look settings on the hosted widget script too', () => {
    stub({ PASSBACK_MODE: '', VERCEL_GIT_PULL_REQUEST_ID: '' });
    const script = Passback({ siteKey: 'pb_abc', endpoint: ENDPOINT, theme: 'dark' });
    const expected = { 'data-passback-theme': 'dark', 'data-passback-endpoint': INGEST };
    expect(script?.props).toMatchObject(expected);
  });

  it('warns and renders the hosted widget without look attributes when a setting is bad', () => {
    stub({ PASSBACK_MODE: '', VERCEL_GIT_PULL_REQUEST_ID: '' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = { siteKey: 'pb_abc', endpoint: ENDPOINT, corner: 'middle' } as never;
    expect(() => Passback(bad)).not.toThrow();
    const script = Passback(bad) as ReactElement;
    expect(warn).toHaveBeenCalledWith(CORNER_MESSAGE);
    expect(script.props).toMatchObject({ 'data-passback-endpoint': INGEST });
    expect(script.props).not.toHaveProperty('data-passback-corner');
  });
});
