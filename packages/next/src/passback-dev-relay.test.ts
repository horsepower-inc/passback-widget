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

function children(element: ReactElement | null): ReactElement[] {
  if (element === null) throw new Error('expected an element');
  const kids = (element.props as { children?: ReactElement[] }).children;
  return element.type === 'script' ? [element] : (kids ?? []);
}

function widgetProps(element: ReactElement | null): Record<string, unknown> {
  const found = children(element).filter((s) =>
    String((s.props as { src?: string }).src ?? '').endsWith('/widget.js'),
  );
  expect(found).toHaveLength(1);
  return found[0]!.props as Record<string, unknown>;
}

describe('Passback in next dev with a site key', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    env({ PASSBACK_MODE: 'dev' });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('puts the relay endpoint on the dev widget script beside the hot shim when a site key is given and mode is left out', () => {
    const element = Passback({ siteKey: 'pb_abc', endpoint: 'https://relay.example.com/' });
    const [shim] = children(element);
    expect(shim!.props).toHaveProperty('dangerouslySetInnerHTML');
    expect(shim!.props).not.toHaveProperty(EP);
    expect(widgetProps(element)).toMatchObject({
      src: '/api/passback/widget.js',
      'data-passback-chunk': '/api/passback/collector.js',
      [EP]: 'https://relay.example.com/v1/ingest/pb_abc',
    });
    expect(children(element)).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses the production relay in next dev when only a site key is given', () => {
    expect(widgetProps(Passback({ siteKey: 'pb_abc' }))[EP]).toBe(
      `${DEFAULT_API}/v1/ingest/pb_abc`,
    );
  });

  it('turns screenshots on beside the shim unless screenshots is false', () => {
    expect(widgetProps(Passback({ siteKey: 'pb_abc' }))[SHOTS]).toBe('true');
    const off = widgetProps(Passback({ siteKey: 'pb_abc', screenshots: false }));
    expect(off).not.toHaveProperty(SHOTS);
    expect(off[EP]).toBe(`${DEFAULT_API}/v1/ingest/pb_abc`);
  });

  it('keeps next dev on the agent tag when mode is agent or the site key is blank', () => {
    const cases: PassbackProps[] = [{ siteKey: 'pb_abc', mode: 'agent' }, { siteKey: '  ' }, {}];
    for (const props of cases) {
      const all = children(Passback(props));
      expect(all).toHaveLength(2);
      for (const script of all) expect(script.props).not.toHaveProperty(EP);
    }
    expect(Passback({ siteKey: 'pb_abc', mode: 'off' })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps mode relay on the relay tag alone in next dev', () => {
    const element = Passback({ siteKey: 'pb_abc', mode: 'relay' });
    expect(element!.type).toBe('script');
    expect(widgetProps(element)[EP]).toBe(`${DEFAULT_API}/v1/ingest/pb_abc`);
  });

  it('warns and keeps the agent tag in next dev when the endpoint is invalid', () => {
    const element = Passback({ siteKey: 'pb_abc', endpoint: 'ftp://nope' });
    const all = children(element);
    expect(all).toHaveLength(2);
    expect(widgetProps(element)).not.toHaveProperty(EP);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('siteKey needs endpoint');
    expect(Passback({ siteKey: 'pb_abc', endpoint: 'ftp://nope', mode: 'relay' })).toBeNull();
  });

  it('adds no pull request script beside the shim', () => {
    env({ PASSBACK_MODE: 'dev', VERCEL_GIT_PULL_REQUEST_ID: '104', PASSBACK_REVIEW_ID: '104' });
    const all = children(Passback({ siteKey: 'pb_abc' }));
    expect(all).toHaveLength(2);
    for (const script of all) {
      const html = (script.props as { dangerouslySetInnerHTML?: { __html: string } })
        .dangerouslySetInnerHTML?.__html;
      expect(html ?? '').not.toContain('passback:pr');
    }
  });
});
