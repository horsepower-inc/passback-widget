import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Passback, type PassbackProps } from './passback';

const ENDPOINT = 'https://api.example.com';
const INGEST = ENDPOINT + '/v1/ingest/pb_abc';
const SITE = { siteKey: 'pb_abc', endpoint: ENDPOINT };
const SHOTS = 'data-passback-screenshots';

function scripts(element: ReactElement | null): ReactElement[] {
  if (element === null) throw new Error('expected an element');
  const kids = (element.props as { children?: ReactElement[] }).children;
  return element.type === 'script' ? [element] : (kids ?? []);
}

function widgetOf(element: ReactElement | null): Record<string, unknown> {
  const widget = scripts(element).filter((s) =>
    String((s.props as { src?: string }).src ?? '').endsWith('/widget.js'),
  );
  expect(widget).toHaveLength(1);
  return widget[0]!.props as Record<string, unknown>;
}

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

const DEV = { PASSBACK_MODE: 'dev' };
// [label, env, props] for every way a page ends up on the relay widget.
const RELAY_CASES: [string, Record<string, string>, PassbackProps][] = [
  ['inferred', {}, SITE],
  ['explicit outside dev', {}, { ...SITE, mode: 'relay' }],
  ['explicit in dev', DEV, { ...SITE, mode: 'relay' }],
];

describe('Passback screenshots', () => {
  beforeEach(() => env({}));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('enables screenshots by default on inferred and explicit relay widgets', () => {
    for (const [, vars, props] of RELAY_CASES) {
      env(vars);
      for (const options of [props, { ...props, screenshots: undefined }]) {
        const widget = widgetOf(Passback(options));
        expect(widget[SHOTS]).toBe('true');
        expect(widget['data-passback-endpoint']).toBe(INGEST);
      }
    }
  });

  it('enables relay screenshots when explicitly true and omits the attribute when false', () => {
    for (const [, vars, props] of RELAY_CASES) {
      env(vars);
      const on = widgetOf(Passback({ ...props, screenshots: true }));
      expect(on[SHOTS]).toBe('true');
      const off = widgetOf(Passback({ ...props, screenshots: false }));
      expect(off).not.toHaveProperty(SHOTS);
      expect(off['data-passback-endpoint']).toBe(INGEST);
    }
  });

  it('never adds screenshots to agent widgets or hot shim scripts', () => {
    const agent: [Record<string, string>, PassbackProps][] = [
      [DEV, { ...SITE, mode: 'agent' }],
      [DEV, {}],
    ];
    for (const [vars, props] of agent) {
      env(vars);
      for (const screenshots of [undefined, true, false]) {
        const element = Passback({ ...props, screenshots });
        const all = scripts(element);
        expect(all).toHaveLength(2);
        for (const script of all) {
          expect(Object.keys(script.props as object)).not.toContain(SHOTS);
          expect(Object.keys(script.props as object)).not.toContain('data-passback-endpoint');
        }
        expect(widgetOf(element)).toMatchObject({
          src: '/api/passback/widget.js',
          'data-passback-chunk': '/api/passback/collector.js',
        });
      }
    }
  });

  it('adds screenshots only to the relay widget when a pull request seed is present', () => {
    env({ VERCEL_GIT_PULL_REQUEST_ID: '104' });
    for (const screenshots of [undefined, false]) {
      const all = scripts(Passback({ ...SITE, screenshots }));
      expect(all).toHaveLength(2);
      const [seed, widget] = all as [ReactElement, ReactElement];
      expect(seed.props).toHaveProperty('dangerouslySetInnerHTML');
      expect(seed.props).not.toHaveProperty('src');
      expect(Object.keys(seed.props as object).filter((k) => k.startsWith('data-'))).toEqual([]);
      expect((widget.props as { src: string }).src).toBe('/api/passback/widget.js');
      expect(widget.props).toMatchObject({ 'data-passback-endpoint': INGEST });
      if (screenshots === false) expect(widget.props).not.toHaveProperty(SHOTS);
      else expect(widget.props).toMatchObject({ [SHOTS]: 'true' });
    }
  });

  it('preserves disabled rendering and explicit invalid relay configuration with screenshots enabled', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(Passback({ ...SITE, mode: 'off', screenshots: true })).toBeNull();
    expect(Passback({ ...SITE, mode: 'agent', screenshots: true })).toBeNull();
    expect(warn).not.toHaveBeenCalled();

    expect(Passback({ endpoint: ENDPOINT, mode: 'relay', screenshots: true })).toBeNull();
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining("mode 'relay' needs siteKey"));
    const bad = ['', 'ftp://api.example.com', 'not a url'];
    for (const endpoint of bad) {
      expect(Passback({ siteKey: 'pb_abc', endpoint, screenshots: true })).toBeNull();
      expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('siteKey needs endpoint'));
    }
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('preserves relay screenshot selection when look settings fall back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const message =
      'passback: corner must be bottom-right, bottom-left, top-right or top-left, got "middle"';
    for (const screenshots of [undefined, false]) {
      warn.mockClear();
      const widget = widgetOf(Passback({ ...SITE, corner: 'middle', screenshots } as never));
      expect(warn).toHaveBeenCalledWith(message);
      expect(widget).not.toHaveProperty('data-passback-corner');
      expect(widget['data-passback-endpoint']).toBe(INGEST);
      if (screenshots === false) expect(widget).not.toHaveProperty(SHOTS);
      else expect(widget[SHOTS]).toBe('true');
    }
  });
});
