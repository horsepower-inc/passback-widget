// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Environment } from '@passback/schema';
import { collectEnvironment } from './environment';

type MediaMatcher = (query: string) => boolean;

function stubMatchMedia(matches: MediaMatcher): void {
  window.matchMedia = ((query: string) =>
    ({ matches: matches(query) }) as MediaQueryList) as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('collectEnvironment', () => {
  it('reads viewport, dpr, locale and timezone', () => {
    const env = collectEnvironment(window);

    expect(env.ua).toBe(window.navigator.userAgent);
    expect(env.viewport).toEqual([window.innerWidth, window.innerHeight]);
    expect(env.dpr).toBe(window.devicePixelRatio || 1);
    expect(env.locale).toBe(window.navigator.language);
    expect(env.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('reports dark colour scheme and reduced motion from matchMedia', () => {
    stubMatchMedia(
      (query) =>
        query === '(prefers-color-scheme: dark)' || query === '(prefers-reduced-motion: reduce)',
    );

    const env = collectEnvironment(window);

    expect(env.colorScheme).toBe('dark');
    expect(env.reducedMotion).toBe(true);
  });

  it('falls back to light and false without matchMedia', () => {
    (window as unknown as { matchMedia?: unknown }).matchMedia = undefined;

    const env = collectEnvironment(window);

    expect(env.colorScheme).toBe('light');
    expect(env.reducedMotion).toBe(false);
  });

  it('omits connection when navigator.connection is absent', () => {
    const env = collectEnvironment(window);

    expect(env.connection).toBeUndefined();
    expect('connection' in env).toBe(false);
  });

  it('validates against the schema Environment', () => {
    stubMatchMedia(() => false);

    const env = collectEnvironment(window);

    expect(() => Environment.parse(env)).not.toThrow();
  });
});
