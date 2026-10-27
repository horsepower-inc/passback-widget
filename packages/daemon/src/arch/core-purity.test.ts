import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 08 §1: core/ imports NOTHING. 08 §7 Tier 2: no Date, timers, console, process or fetch
// outside their adapters. This test reads source text so it needs neither eslint nor
// dependency-cruiser, both of which are code-owned.

type CoreFile = { path: string; text: string };

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function specifiers(code: string): string[] {
  const re =
    /from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec !== undefined) found.push(spec);
  }
  return found;
}

const GLOBAL_CHECKS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'Date', re: /(?<![.\w$])Date\b/ },
  { name: 'setTimeout', re: /(?<![.\w$])setTimeout\b/ },
  { name: 'setInterval', re: /(?<![.\w$])setInterval\b/ },
  { name: 'console', re: /(?<![.\w$])console\./ },
  { name: 'process', re: /(?<![.\w$])process\./ },
  { name: 'fetch', re: /(?<![.\w$])fetch\(/ },
];

// A relative import that resolves to a file inside core/ (a sibling or a subfolder: feature
// folders are allowed, 04 Decisions 2026-10-18); a package, a builtin or anything outside core/ is not.
function staysInCore(from: string, spec: string): boolean {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return false;
  return posix.join(posix.dirname(from), spec).startsWith('core/');
}

function coreViolations(files: ReadonlyArray<CoreFile>): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const text = stripComments(file.text);
    for (const spec of specifiers(text)) {
      if (!staysInCore(file.path, spec)) violations.push(`${file.path}: imports ${spec}`);
    }
    for (const check of GLOBAL_CHECKS) {
      if (check.re.test(text)) violations.push(`${file.path}: uses ${check.name}`);
    }
  }
  return violations;
}

function coreFiles(dir: string): CoreFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
    .map((entry) => ({ rel: entry.split(sep).join('/'), full: join(dir, entry) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
    .map(({ rel, full }) => ({ path: `core/${rel}`, text: readFileSync(full, 'utf8') }));
}

describe('daemon core purity', () => {
  it('core imports nothing outside core and reaches no ambient I/O', () => {
    const dir = fileURLToPath(new URL('../core', import.meta.url));
    expect(coreViolations(coreFiles(dir))).toEqual([]);
  });

  it('flags a package import in a sample core file', () => {
    const files = [{ path: 'core/x.ts', text: "import { a } from '@passback/inbox';\n" }];
    expect(coreViolations(files)).toEqual(['core/x.ts: imports @passback/inbox']);
  });

  it('flags a parent-directory import', () => {
    const files = [{ path: 'core/x.ts', text: "import type { C } from '../adapters/c';\n" }];
    expect(coreViolations(files)).toEqual(['core/x.ts: imports ../adapters/c']);
  });

  it('flags a node builtin import', () => {
    const files = [{ path: 'core/x.ts', text: "import { readFile } from 'node:fs/promises';\n" }];
    expect(coreViolations(files)).toEqual(['core/x.ts: imports node:fs/promises']);
  });

  it('flags Date, timers, console, process and fetch', () => {
    const text = [
      'const d = new Date();',
      'setTimeout(() => {}, 0);',
      'setInterval(() => {}, 0);',
      "console.log('hi');",
      'process.env.FOO;',
      "fetch('/x');",
    ].join('\n');
    const files = [{ path: 'core/x.ts', text }];
    expect(coreViolations(files)).toEqual([
      'core/x.ts: uses Date',
      'core/x.ts: uses setTimeout',
      'core/x.ts: uses setInterval',
      'core/x.ts: uses console',
      'core/x.ts: uses process',
      'core/x.ts: uses fetch',
    ]);
  });

  it('ignores words inside comments', () => {
    const text = [
      '// Date.now() setTimeout console.log',
      '/*',
      ' * setTimeout',
      ' * console.log',
      ' * Date.now()',
      ' */',
      'export const ok = 1;',
    ].join('\n');
    const files = [{ path: 'core/x.ts', text }];
    expect(coreViolations(files)).toEqual([]);
  });

  it('accepts a sibling import and a method named like a global', () => {
    const text = [
      "import type { Clock } from './clock';",
      'clock.setTimeout(); obj.process.x; this.fetch(u);',
    ].join('\n');
    const files = [{ path: 'core/x.ts', text }];
    expect(coreViolations(files)).toEqual([]);
  });

  it('flags a relative specifier that leaves core, and accepts a subfolder inside it', () => {
    const files = [
      {
        path: 'core/x.ts',
        text: [
          "import { a } from './../adapters/a';",
          "import { b } from './sub/b';",
          "import { i } from './..';",
          "import { j } from './.';",
        ].join('\n'),
      },
    ];
    expect(coreViolations(files)).toEqual([
      'core/x.ts: imports ./../adapters/a',
      'core/x.ts: imports ./..',
      'core/x.ts: imports ./.',
    ]);
  });

  it('reads core files in subdirectories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'core-purity-'));
    try {
      writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'sub', 'b.ts'), "import { a } from '../a';\nimport { c } from '../../c';\n");
      writeFileSync(join(dir, 'sub', 'b.test.ts'), '');
      const files = coreFiles(dir);
      expect(files.map((f) => f.path)).toEqual(['core/a.ts', 'core/sub/b.ts']);
      expect(coreViolations(files)).toEqual(['core/sub/b.ts: imports ../../c']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
