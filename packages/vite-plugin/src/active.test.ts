import { afterEach, describe, expect, it } from 'vitest';
import { isActive, isTestRun } from './active';
import { passback } from './plugin';

describe('isTestRun', () => {
  it('is a test run when the Vite mode is test', () => {
    expect(isTestRun({ mode: 'test' }, {})).toBe(true);
  });

  it('is a test run when VITEST is set', () => {
    expect(isTestRun({ mode: 'development' }, { VITEST: 'true' })).toBe(true);
  });

  it('is not a test run in a normal mode without VITEST', () => {
    expect(isTestRun({ mode: 'development' }, {})).toBe(false);
    expect(isTestRun({ mode: 'development' }, { VITEST: '' })).toBe(false);
  });
});

describe('plugin in a test run', () => {
  const saved = process.env.VITEST;
  afterEach(() => {
    if (saved === undefined) delete process.env.VITEST;
    else process.env.VITEST = saved;
  });

  function applies(options: Parameters<typeof passback>[0]): boolean {
    const apply = passback(options).apply as (c: unknown, e: unknown) => boolean;
    return apply({}, { command: 'serve', mode: 'development' });
  }

  it('stays off in a test run unless enableInTests is set', () => {
    process.env.VITEST = 'true';
    expect(applies({})).toBe(false);
    expect(applies({ enableInTests: true })).toBe(true);
  });
});

describe('isActive', () => {
  it('is active when Vite serves', () => {
    expect(isActive({ command: 'serve', mode: 'development' }, [])).toBe(true);
  });

  it('is inactive in a production build by default', () => {
    expect(isActive({ command: 'build', mode: 'production' }, [])).toBe(false);
  });

  it('is active in a build whose mode is listed in stagingModes', () => {
    expect(isActive({ command: 'build', mode: 'staging' }, ['staging'])).toBe(true);
  });

  it('is inactive in a build whose mode is not listed', () => {
    expect(isActive({ command: 'build', mode: 'production' }, ['staging'])).toBe(false);
  });
});
