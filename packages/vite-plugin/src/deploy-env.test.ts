import type { HtmlTagDescriptor, IndexHtmlTransformContext, ResolvedConfig } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pullRequestFromEnv, pullRequestScript } from './deploy-env';
import { passback } from './plugin';

type ConfigResolvedFn = (config: ResolvedConfig) => void;
type TransformIndexHtmlFn = (html: string, ctx: IndexHtmlTransformContext) => HtmlTagDescriptor[];

const NO_CTX = { path: '/index.html' } as IndexHtmlTransformContext;
const HOSTED = { siteKey: 'pb_abc', endpoint: 'https://api.example.com' };

function runScript(storage: unknown): void {
  new Function('sessionStorage', pullRequestScript(104))(storage);
}

function memoryStorage(initial?: string) {
  const items = new Map<string, string>();
  if (initial !== undefined) items.set('passback:pr', initial);
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

function seedTags(
  options: Parameters<typeof passback>[0],
  command: 'build' | 'serve',
  mode = 'production',
): HtmlTagDescriptor[] {
  const plugin = passback({ buildId: 'b1', ...options });
  const configResolved = plugin.configResolved as unknown as ConfigResolvedFn;
  configResolved({ root: '/tmp/none', command, mode } as ResolvedConfig);
  const transformIndexHtml = plugin.transformIndexHtml as unknown as TransformIndexHtmlFn;
  return transformIndexHtml('', NO_CTX);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('pullRequestFromEnv', () => {
  it('reads the pull request number from VERCEL_GIT_PULL_REQUEST_ID', () => {
    expect(pullRequestFromEnv({ VERCEL_GIT_PULL_REQUEST_ID: '104' })).toBe(104);
  });

  it('reads REVIEW_ID only on a Netlify deploy preview', () => {
    expect(pullRequestFromEnv({ CONTEXT: 'deploy-preview', REVIEW_ID: '7' })).toBe(7);
    expect(pullRequestFromEnv({ CONTEXT: 'production', REVIEW_ID: '7' })).toBeUndefined();
  });

  it('ignores an empty, zero, signed or non-numeric value', () => {
    for (const value of ['', '0', '012', '-3', 'abc', '1234567890']) {
      expect(pullRequestFromEnv({ VERCEL_GIT_PULL_REQUEST_ID: value })).toBeUndefined();
    }
  });
});

describe('pullRequestScript', () => {
  it('keeps the number for the tab only when the tab has none', () => {
    const empty = memoryStorage();
    runScript(empty);
    expect(empty.items.get('passback:pr')).toBe('104');
    const kept = memoryStorage('7');
    runScript(kept);
    expect(kept.items.get('passback:pr')).toBe('7');
  });

  it('runs without throwing when session storage throws', () => {
    const boom = () => {
      throw new Error('blocked');
    };
    expect(() => runScript({ getItem: boom, setItem: boom })).not.toThrow();
  });
});

describe('passback pull request script', () => {
  it('adds the pull request script before the widget in a hosted build', () => {
    vi.stubEnv('VERCEL_GIT_PULL_REQUEST_ID', '104');
    const tags = seedTags(HOSTED, 'build');
    const seed = tags.findIndex((tag) => String(tag.children ?? '').includes('passback:pr'));
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(tags[seed]!.children).toBe(pullRequestScript(104));
  });

  it('adds no pull request script without a site key or outside a build', () => {
    vi.stubEnv('VERCEL_GIT_PULL_REQUEST_ID', '104');
    const cases = [
      seedTags({ stagingModes: ['staging'] }, 'build', 'staging'),
      seedTags({ ...HOSTED, mode: 'agent' }, 'build'),
      seedTags({ siteKey: 'pb_abc' }, 'serve'),
      seedTags({ ...HOSTED, mode: 'relay' }, 'serve'),
    ];
    for (const tags of cases) {
      expect(tags.some((tag) => String(tag.children ?? '').includes('passback:pr'))).toBe(false);
    }
  });
});
