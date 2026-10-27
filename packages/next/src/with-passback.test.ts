import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withPassback } from './with-passback';

const LOADER = fileURLToPath(new URL('./loader.cjs', import.meta.url));

type Rule = { test?: RegExp; exclude?: RegExp; enforce?: string; use?: unknown };
type Wp = { module?: { rules?: Rule[] } };

function dev(root = ''): void {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('PASSBACK_ROOT', root);
  vi.stubEnv('PASSBACK_MODE', '');
  vi.stubEnv('PASSBACK_BASE_PATH', '');
  vi.stubEnv('PASSBACK_BUILD_ID', '');
}

function runWebpack(config: NextConfig, isDev: boolean, input: Wp = {}): Wp {
  const fn = config.webpack as unknown as (c: Wp, ctx: { dev: boolean }) => Wp;
  return fn(input, { dev: isDev });
}

function turbopackRules(config: NextConfig): Record<string, unknown> {
  return (config.turbopack?.rules ?? {}) as Record<string, unknown>;
}

const item = {
  condition: { all: [{ not: 'foreign' }, 'development'] },
  loaders: [{ loader: LOADER, options: { root: '/r' } }],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('withPassback', () => {
  it('returns the same config object outside development when there is nothing to inline', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CONTEXT', '');
    vi.stubEnv('REVIEW_ID', '');
    const config: NextConfig = { reactStrictMode: true };
    expect(withPassback(config)).toBe(config);
  });

  it('inlines the base path into a production build through env', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PASSBACK_MODE', '');
    const out = withPassback({ basePath: '/docs', env: { KEEP: '1' } });
    expect(out.env).toEqual({ KEEP: '1', PASSBACK_BASE_PATH: '/docs' });
    expect(out.basePath).toBe('/docs');
    expect(out).not.toHaveProperty('webpack');
    expect(out).not.toHaveProperty('turbopack');
    expect(process.env.PASSBACK_MODE).toBe('');
  });

  it('inlines the Netlify pull request number of a deploy preview build', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CONTEXT', 'deploy-preview');
    vi.stubEnv('REVIEW_ID', '42');
    expect(withPassback({}).env).toEqual({ PASSBACK_REVIEW_ID: '42' });
    vi.stubEnv('CONTEXT', 'production');
    const config: NextConfig = {};
    expect(withPassback(config)).toBe(config);
  });

  it('inlines no review id that is not a pull request number', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CONTEXT', 'deploy-preview');
    for (const value of ['abc', '0', '012', '']) {
      vi.stubEnv('REVIEW_ID', value);
      const config: NextConfig = {};
      expect(withPassback(config)).toBe(config);
    }
  });

  it('adds no env in development', () => {
    dev('/r');
    expect(withPassback({ basePath: '/app' }).env).toBeUndefined();
  });

  it('sets PASSBACK_MODE, PASSBACK_ROOT and PASSBACK_BASE_PATH in development', () => {
    dev();
    withPassback({ basePath: '/app' }, { root: '/tmp/some-root' });
    expect(process.env.PASSBACK_MODE).toBe('dev');
    expect(process.env.PASSBACK_ROOT).toBe('/tmp/some-root');
    expect(process.env.PASSBACK_BASE_PATH).toBe('/app');
  });

  it('resolves the root option against the working directory', () => {
    dev();
    withPassback({}, { root: 'sub/dir' });
    expect(process.env.PASSBACK_ROOT).toBe(path.resolve(process.cwd(), 'sub/dir'));
    expect(process.env.PASSBACK_BASE_PATH).toBe('');
  });

  it('lets PASSBACK_ROOT override the root option', () => {
    dev('/from/env');
    withPassback({}, { root: 'sub/dir' });
    expect(process.env.PASSBACK_ROOT).toBe('/from/env');
  });

  it('keeps every other config key', () => {
    dev('/r');
    const out = withPassback({ basePath: '/b', reactStrictMode: true });
    expect(out.basePath).toBe('/b');
    expect(out.reactStrictMode).toBe(true);
  });

  it('adds a pre loader rule for tsx and jsx through webpack', () => {
    dev('/r');
    const out = runWebpack(withPassback({}), true);
    expect(out.module?.rules).toEqual([
      {
        test: /\.(jsx|tsx)$/,
        exclude: /node_modules/,
        enforce: 'pre',
        use: [{ loader: LOADER, options: { root: '/r' } }],
      },
    ]);
  });

  it('calls an existing webpack function first and keeps its result', () => {
    dev('/r');
    const existing = { test: /\.x$/ };
    const webpack = vi.fn((c: Wp) => ({ module: { rules: [existing] }, extra: c }));
    const out = runWebpack(withPassback({ webpack: webpack as never }), true);
    expect(webpack).toHaveBeenCalledOnce();
    expect(out.module?.rules?.[0]).toBe(existing);
    expect(out.module?.rules).toHaveLength(2);
    expect(out).toHaveProperty('extra');
  });

  it('adds no webpack rule when the compiler is not a dev compiler', () => {
    dev('/r');
    const out = runWebpack(withPassback({}), false);
    expect(out.module).toBeUndefined();
  });

  it('adds turbopack rules for tsx and jsx that skip foreign code and run in development only', () => {
    dev('/r');
    const rules = turbopackRules(withPassback({}));
    expect(rules['*.tsx']).toEqual([item]);
    expect(rules['*.jsx']).toEqual([item]);
  });

  it('appends to an object-valued turbopack rule and to an array-valued one', () => {
    dev('/r');
    const obj = { loaders: ['a'] };
    const arr = [{ loaders: ['b'] }];
    const keep = { loaders: ['c'] };
    const rules = turbopackRules(
      withPassback({
        turbopack: { root: '/t', rules: { '*.tsx': obj, '*.jsx': arr, '*.svg': keep } as never },
      }),
    );
    expect(rules['*.tsx']).toEqual([obj, item]);
    expect(rules['*.jsx']).toEqual([...arr, item]);
    expect(rules['*.svg']).toBe(keep);
  });

  it('points the loader option at loader.cjs next to the module', () => {
    dev('/r');
    const rules = turbopackRules(withPassback({}));
    const loaders = (rules['*.tsx'] as (typeof item)[])[0]!.loaders;
    expect(path.basename(loaders[0]!.loader)).toBe('loader.cjs');
    expect(path.dirname(loaders[0]!.loader)).toBe(path.dirname(fileURLToPath(import.meta.url)));
  });

  it('does not reference its loader through new URL and import.meta.url', () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'with-passback.ts');
    expect(readFileSync(file, 'utf8')).not.toMatch(/new URL\([^)]*import\.meta\.url/);
  });

  it('does not resolve the loader path when the module loads', async () => {
    vi.resetModules();
    const spy = vi.fn();
    vi.doMock('node:url', async () => {
      const real = await vi.importActual<typeof import('node:url')>('node:url');
      spy.mockImplementation(real.fileURLToPath);
      return { ...real, default: real, fileURLToPath: spy };
    });
    try {
      const mod = await import('./with-passback.js');
      expect(spy).not.toHaveBeenCalled();
      dev('/r');
      mod.withPassback({}, { root: '/r' });
      expect(spy).toHaveBeenCalled();
    } finally {
      vi.doUnmock('node:url');
      vi.resetModules();
    }
  });
});
