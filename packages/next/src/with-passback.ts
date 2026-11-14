import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { gitBuildId } from '@passback/vite-plugin/manifest';
import { findProjectRoot } from '@passback/vite-plugin/root';

export type WithPassbackOptions = { root?: string };

type WebpackFn = NonNullable<NextConfig['webpack']>;
type WebpackConfig = Parameters<WebpackFn>[0];
type TurbopackRules = NonNullable<NonNullable<NextConfig['turbopack']>['rules']>;
type TurbopackRule = TurbopackRules[string];

const loaderPath = (): string =>
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'loader.cjs');

function resolveRoot(options: WithPassbackOptions | undefined): string {
  const fromEnv = process.env.PASSBACK_ROOT;
  if (fromEnv) return fromEnv;
  if (options?.root) return path.resolve(process.cwd(), options.root);
  return findProjectRoot(process.cwd());
}

function setEnv(root: string, basePath: string): void {
  process.env.PASSBACK_MODE = 'dev';
  process.env.PASSBACK_ROOT = root;
  process.env.PASSBACK_BASE_PATH = basePath;
  const buildId = gitBuildId(root);
  if (buildId) process.env.PASSBACK_BUILD_ID = buildId;
}

function chainWebpack(existing: NextConfig['webpack'], root: string): WebpackFn {
  return (webpackConfig, context) => {
    const result: WebpackConfig =
      typeof existing === 'function' ? existing(webpackConfig, context) : webpackConfig;
    if (context.dev) {
      result.module ??= {};
      result.module.rules ??= [];
      result.module.rules.push({
        test: /\.(jsx|tsx)$/,
        exclude: /node_modules/,
        enforce: 'pre',
        use: [{ loader: loaderPath(), options: { root } }],
      });
    }
    return result;
  };
}

function mergeTurbopackRules(existing: TurbopackRules | undefined, root: string): TurbopackRules {
  const item = {
    condition: { all: [{ not: 'foreign' }, 'development'] },
    loaders: [{ loader: loaderPath(), options: { root } }],
  } as unknown as Exclude<TurbopackRule, readonly unknown[]>;
  const rules: TurbopackRules = { ...existing };
  for (const key of ['*.tsx', '*.jsx']) {
    const current = rules[key];
    if (current === undefined) rules[key] = [item];
    else if (Array.isArray(current)) rules[key] = [...current, item];
    else rules[key] = [current as typeof item, item];
  }
  return rules;
}

const REVIEW_ID = /^[1-9]\d{0,8}$/;

// Next's `env` option inlines process.env.<KEY> at build time, so a deployed render sees these.
function productionEnv(config: NextConfig): Record<string, string> {
  const inlined: Record<string, string> = {};
  if (typeof config.basePath === 'string' && config.basePath !== '') {
    inlined.PASSBACK_BASE_PATH = config.basePath;
  }
  const review = process.env.REVIEW_ID ?? '';
  if (process.env.CONTEXT === 'deploy-preview' && REVIEW_ID.test(review)) {
    inlined.PASSBACK_REVIEW_ID = review;
  }
  return inlined;
}

export function withPassback(config: NextConfig, options?: WithPassbackOptions): NextConfig {
  if (process.env.NODE_ENV !== 'development') {
    const inlined = productionEnv(config);
    if (Object.keys(inlined).length === 0) return config;
    return { ...config, env: { ...config.env, ...inlined } };
  }
  const root = resolveRoot(options);
  setEnv(root, config.basePath ?? '');
  return {
    ...config,
    webpack: chainWebpack(config.webpack, root),
    turbopack: {
      ...config.turbopack,
      rules: mergeTurbopackRules(config.turbopack?.rules, root),
    },
  };
}
