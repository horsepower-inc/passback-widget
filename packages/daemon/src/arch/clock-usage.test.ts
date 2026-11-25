import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 08 §7 Tier 2: ambient time only in adapters. core-purity.test.ts proves core/ reaches no
// ambient time; this test proves the rest of the daemon (outside core/, adapters/ and arch/
// itself) reads no ambient time and starts no timer either, once it has been handed a Clock.
// This test reads source text so it needs neither eslint nor dependency-cruiser.

type DaemonFile = { path: string; text: string };

const EXCLUDED_DIRS = new Set(['core', 'adapters', 'arch']);

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const CHECKS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'Date.now', re: /(?<![.\w$])(?:globalThis\s*\.\s*)?Date\s*\.\s*now\b/ },
  { name: 'new Date()', re: /new (?:globalThis\s*\.\s*)?Date\(\s*\)/ },
  { name: 'setTimeout', re: /(?<![.\w$])(?:globalThis\s*\.\s*)?setTimeout\(/ },
  { name: 'setInterval', re: /(?<![.\w$])(?:globalThis\s*\.\s*)?setInterval\(/ },
];

export function clockViolations(files: ReadonlyArray<DaemonFile>): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const text = stripComments(file.text);
    for (const check of CHECKS) {
      if (check.re.test(text)) violations.push(`${file.path}: uses ${check.name}`);
    }
  }
  return violations;
}

function daemonFiles(dir: string): DaemonFile[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
    .map((entry) => ({ rel: entry.split(sep).join('/'), full: join(dir, entry) }))
    .filter(({ rel }) => !EXCLUDED_DIRS.has(rel.split('/')[0] ?? ''))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
    .map(({ rel, full }) => ({ path: rel, text: readFileSync(full, 'utf8') }));
}

describe('daemon clock usage', () => {
  it('daemon sources outside core and adapters read no ambient time and start no timers', () => {
    const dir = fileURLToPath(new URL('..', import.meta.url));
    expect(clockViolations(daemonFiles(dir))).toEqual([]);
  });

  it('flags Date.now, new Date() without an argument, setTimeout and setInterval', () => {
    const text = [
      'const t = Date.now();',
      'const d = new Date();',
      'setTimeout(() => {}, 0);',
      'setInterval(() => {}, 0);',
    ].join('\n');
    const files = [{ path: 'foo.ts', text }];
    expect(clockViolations(files)).toEqual([
      'foo.ts: uses Date.now',
      'foo.ts: uses new Date()',
      'foo.ts: uses setTimeout',
      'foo.ts: uses setInterval',
    ]);
  });

  it('allows new Date built from a clock reading and a timer method on an object', () => {
    const text = [
      'const at = new Date(clock.now());',
      'this.timers.setTimeout(fn, 10);',
      'scheduler.setInterval(fn, 10);',
    ].join('\n');
    const files = [{ path: 'foo.ts', text }];
    expect(clockViolations(files)).toEqual([]);
  });

  it('flags globalThis-qualified Date.now, new Date(), setTimeout and setInterval', () => {
    const text = [
      'const t = globalThis.Date.now();',
      'const d = new globalThis.Date();',
      'globalThis.setTimeout(() => {}, 0);',
      'globalThis.setInterval(() => {}, 0);',
    ].join('\n');
    expect(clockViolations([{ path: 'foo.ts', text }])).toEqual([
      'foo.ts: uses Date.now',
      'foo.ts: uses new Date()',
      'foo.ts: uses setTimeout',
      'foo.ts: uses setInterval',
    ]);

    const spaced = [
      'const t = globalThis . Date . now();',
      'const d = new globalThis . Date();',
      'globalThis . setTimeout(() => {}, 0);',
      'globalThis\n  .setInterval(() => {}, 0);',
    ].join('\n');
    expect(clockViolations([{ path: 'bar.ts', text: spaced }])).toEqual([
      'bar.ts: uses Date.now',
      'bar.ts: uses new Date()',
      'bar.ts: uses setTimeout',
      'bar.ts: uses setInterval',
    ]);
  });

  it('allows a globalThis-qualified call that is really a property of another object', () => {
    const text = [
      'foo.globalThis.setTimeout(fn, 1);',
      'foo.globalThis.setInterval(fn, 1);',
      'foo.globalThis.Date.now();',
      'const at = new Date(clock.now());',
    ].join('\n');
    expect(clockViolations([{ path: 'foo.ts', text }])).toEqual([]);
  });

  it('ignores the words inside comments', () => {
    const text = [
      '// Date.now() new Date() setTimeout( setInterval(',
      '/*',
      ' * Date.now()',
      ' * new Date()',
      ' * setTimeout(',
      ' * setInterval(',
      ' */',
      'export const ok = 1;',
    ].join('\n');
    const files = [{ path: 'foo.ts', text }];
    expect(clockViolations(files)).toEqual([]);
  });
});
