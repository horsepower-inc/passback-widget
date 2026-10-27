import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Passback, type PassbackProps } from './passback';

const DEFAULT_API = 'https://api.passback.dev';
const EP = 'data-passback-endpoint';
const SHOTS = 'data-passback-screenshots';

function env(vars: Record<string, string>): void {
  const clean = {
    PASSBACK_MODE: '',
    PASSBACK_BASE_PATH: '',
    PASSBACK_BUILD_ID: '',
    PASSBACK_REVIEW_ID: '',
    VERCEL_GIT_PULL_REQUEST_ID: '',
    REVIEW_ID: '',
    CONTEXT: '',
  };
  for (const [name, value] of Object.entries({ ...clean, ...vars })) vi.stubEnv(name, value);
}

function scripts(element: ReactElement | null): ReactElement[] {
  if (element === null) throw new Error('expected an element');
  const kids = (element.props as { children?: ReactElement[] }).children;
  return element.type === 'script' ? [element] : (kids ?? []);
}

function widgetProps(element: ReactElement | null): Record<string, unknown> {
  const found = scripts(element).filter((s) =>
    String((s.props as { src?: string }).src ?? '').endsWith('/widget.js'),
  );
  expect(found).toHaveLength(1);
  return found[0]!.props as Record<string, unknown>;
}

describe('Passback endpoint default', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    env({});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('defaults omitted and undefined relay endpoints to the production API', () => {
    const cases: [Record<string, string>, PassbackProps][] = [
      [{}, { siteKey: 'pb_abc' }],
      [{}, { siteKey: 'pb_abc', endpoint: undefined }],
      [{ PASSBACK_MODE: 'dev' }, { siteKey: 'pb_abc', mode: 'relay' }],
      [{ PASSBACK_MODE: 'dev' }, { siteKey: 'pb_abc', endpoint: undefined, mode: 'relay' }],
    ];
    for (const [vars, props] of cases) {
      env(vars);
      expect(widgetProps(Passback(props))[EP]).toBe(`${DEFAULT_API}/v1/ingest/pb_abc`);
    }
    env({});
    expect(widgetProps(Passback({ siteKey: '  pb key/1  ' }))[EP]).toBe(
      `${DEFAULT_API}/v1/ingest/pb%20key%2F1`,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('preserves custom HTTP and HTTPS relay endpoints', () => {
    const cases: [string, string][] = [
      ['https://relay.example.com', 'https://relay.example.com'],
      ['  http://localhost:8787/  ', 'http://localhost:8787'],
      ['https://relay.example.com/base///', 'https://relay.example.com/base'],
    ];
    for (const [endpoint, base] of cases) {
      expect(widgetProps(Passback({ siteKey: 'pb_abc', endpoint }))[EP]).toBe(
        `${base}/v1/ingest/pb_abc`,
      );
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps endpoint defaults out of agent and off modes', () => {
    env({ PASSBACK_MODE: 'dev' });
    for (const props of [{ siteKey: 'pb_abc', mode: 'agent' as const }]) {
      const all = scripts(Passback(props));
      expect(all).toHaveLength(2);
      for (const script of all) expect(script.props).not.toHaveProperty(EP);
    }
    expect(Passback({ siteKey: 'pb_abc', mode: 'off' })).toBeNull();
    env({});
    expect(Passback({ siteKey: 'pb_abc', mode: 'agent' })).toBeNull();
    expect(Passback({ siteKey: 'pb_abc', mode: 'off' })).toBeNull();
    env({ PASSBACK_MODE: 'dev' });
    expect(Passback({ siteKey: 'pb_abc', mode: 'off' })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('preserves relay attributes and pull request seeding with the default endpoint', () => {
    env({ PASSBACK_BASE_PATH: '/docs' });
    const plain = widgetProps(Passback({ siteKey: 'pb_abc', theme: 'dark' }));
    expect(plain).toMatchObject({
      async: true,
      src: '/docs/api/passback/widget.js',
      'data-passback-chunk': '/docs/api/passback/collector.js',
      'data-passback-theme': 'dark',
      [EP]: `${DEFAULT_API}/v1/ingest/pb_abc`,
      [SHOTS]: 'true',
    });
    expect(widgetProps(Passback({ siteKey: 'pb_abc', screenshots: false }))).not.toHaveProperty(
      SHOTS,
    );

    env({ VERCEL_GIT_PULL_REQUEST_ID: '104' });
    const [seed, widget] = scripts(Passback({ siteKey: 'pb_abc' })) as [ReactElement, ReactElement];
    expect(
      (seed.props as { dangerouslySetInnerHTML: { __html: string } }).dangerouslySetInnerHTML,
    ).toEqual({
      __html:
        'try{sessionStorage.getItem("passback:pr")||sessionStorage.setItem("passback:pr","104")}catch(e){}',
    });
    expect(widget.props).toMatchObject({ [EP]: `${DEFAULT_API}/v1/ingest/pb_abc` });
    expect(warn).not.toHaveBeenCalled();
  });
});
