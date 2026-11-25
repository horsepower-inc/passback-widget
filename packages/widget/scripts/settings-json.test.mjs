import { execFile } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const widgetDir = fileURLToPath(new URL('..', import.meta.url));
const inventoryPath = join(widgetDir, 'settings.json');
const buildSource = join(widgetDir, 'scripts', 'build.mjs');
const inventory = () => JSON.parse(readFileSync(inventoryPath, 'utf8'));

const INTERNAL = new Set(['data-passback-host', 'data-passback-phase']);
const TOKEN = /data-passback-[a-z0-9]+(?:-[a-z0-9]+)*/g;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    const production = /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name);
    return production && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

function discover(srcDir) {
  const found = new Set();
  for (const file of sourceFiles(srcDir)) {
    for (const token of readFileSync(file, 'utf8').match(TOKEN) ?? []) found.add(token);
  }
  return [...found].filter((name) => !INTERNAL.has(name)).sort();
}

function compare(discovered, keys) {
  return {
    missing: discovered.filter((name) => !keys.includes(name)),
    stale: keys.filter((name) => !discovered.includes(name)),
  };
}

const roots = [];
const tempRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'passback-settings-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// A widget directory holding the real build script, a stub esbuild that records its calls,
// and a stub bundle list, so the build runs without bundling anything.
function fixture({ withSettings = true } = {}) {
  const root = tempRoot();
  const widget = join(root, 'widget');
  const scripts = join(widget, 'scripts');
  const log = join(root, 'calls.log');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(join(widget, 'node_modules', 'esbuild'), { recursive: true });
  cpSync(buildSource, join(scripts, 'build.mjs'));
  writeFileSync(
    join(scripts, 'bundles.mjs'),
    `export const BUNDLES = ['one'];
export const buildOptions = (b) => b;
export const watchRequested = (args) => args.includes('--watch');
`,
  );
  writeFileSync(
    join(widget, 'node_modules', 'esbuild', 'package.json'),
    '{"name":"esbuild","type":"module","main":"index.js"}',
  );
  writeFileSync(
    join(widget, 'node_modules', 'esbuild', 'index.js'),
    `import { appendFileSync, existsSync } from 'node:fs';
const note = (what) =>
  appendFileSync(${JSON.stringify(log)}, what + ':' + existsSync(new URL('../../dist/settings.json', import.meta.url)) + '\\n');
export const build = async () => note('build');
export const context = async () => {
  note('context');
  return { watch: async () => note('watch') };
};
`,
  );
  if (withSettings) writeFileSync(join(widget, 'settings.json'), '{"b":1,\n "a":"\\u00e9"}\n');
  const run = (...args) =>
    execFileAsync(process.execPath, [join(scripts, 'build.mjs'), ...args], { cwd: widget }).then(
      () => 0,
      (error) => error.code,
    );
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
  return { widget, dest: join(widget, 'dist', 'settings.json'), run, calls };
}

describe('widget settings inventory', () => {
  it('lists every script setting read by the widget source', () => {
    const discovered = discover(join(widgetDir, 'src'));
    expect(discovered.length).toBeGreaterThan(0);
    expect(compare(discovered, Object.keys(inventory()))).toEqual({ missing: [], stale: [] });
  });

  it('rejects missing and stale settings and excludes only host and phase', () => {
    const root = tempRoot();
    const src = join(root, 'src');
    mkdirSync(join(src, 'nested'), { recursive: true });
    writeFileSync(
      join(src, 'a.ts'),
      `const h = 'data-passback-host'; const p = "[data-passback-phase='x']"; const s = 'data-passback-new';
const k = 'data-passback-kept';`,
    );
    writeFileSync(join(src, 'nested', 'b.ts'), `x('data-passback-nested-one');`);
    writeFileSync(join(src, 'a.test.ts'), `'data-passback-in-test'`);
    writeFileSync(join(src, 'a.d.ts'), `'data-passback-in-types'`);
    const discovered = discover(src);
    expect(discovered).toEqual([
      'data-passback-kept',
      'data-passback-nested-one',
      'data-passback-new',
    ]);
    expect(compare(discovered, ['data-passback-kept', 'data-passback-old'])).toEqual({
      missing: ['data-passback-nested-one', 'data-passback-new'],
      stale: ['data-passback-old'],
    });
    expect(discover(join(widgetDir, 'src'))).not.toEqual(expect.arrayContaining([...INTERNAL]));
  });

  it('describes existing setting types defaults and allowed values', () => {
    const entries = Object.entries(inventory());
    expect(entries).toHaveLength(14);
    for (const [name, entry] of entries) {
      expect(name).toMatch(/^data-passback-[a-z-]+$/);
      expect(Object.keys(entry).sort()).toEqual([
        'allowedValues',
        'default',
        'description',
        'type',
      ]);
      expect(['boolean', 'string']).toContain(entry.type);
      expect(typeof entry.description).toBe('string');
      expect(entry.description.trim()).not.toBe('');
      if (entry.allowedValues !== null) {
        expect(Array.isArray(entry.allowedValues)).toBe(true);
        for (const value of entry.allowedValues) expect(typeof value).toBe(entry.type);
        expect(entry.allowedValues).toContain(entry.default);
      }
      if (entry.default !== null) expect(typeof entry.default).toBe(entry.type);
    }
    const settings = inventory();
    const p = (suffix) => settings[`data-passback-${suffix}`];
    expect(p('auto-start')).toMatchObject({
      type: 'boolean',
      default: true,
      allowedValues: [true, false],
    });
    expect(p('screenshots')).toMatchObject({
      type: 'boolean',
      default: false,
      allowedValues: [true, false],
    });
    expect(p('corner').allowedValues).toEqual([
      'bottom-right',
      'bottom-left',
      'top-right',
      'top-left',
    ]);
    expect(p('launcher')).toMatchObject({
      default: 'visible',
      allowedValues: ['visible', 'hidden'],
    });
    expect(p('theme')).toMatchObject({ default: 'auto', allowedValues: ['auto', 'light', 'dark'] });
    expect(p('hotkey')).toMatchObject({ default: 'alt+shift+r', allowedValues: null });
    expect(p('hide-hotkey')).toMatchObject({ default: 'alt+shift+h', allowedValues: null });
    for (const s of ['main', 'secondary', 'panel'])
      expect(p(s)).toMatchObject({ default: '', allowedValues: null });
    for (const s of ['chunk', 'endpoint', 'shot', 'shot-upload']) {
      expect(p(s)).toMatchObject({ type: 'string', default: null, allowedValues: null });
    }
  });
});

describe('widget settings distribution', () => {
  it('copies settings.json byte for byte before building or watching', async () => {
    for (const mode of [[], ['--watch']]) {
      const f = fixture();
      expect(await f.run(...mode)).toBe(0);
      expect(readFileSync(f.dest)).toEqual(readFileSync(join(f.widget, 'settings.json')));
      expect(f.calls()[0]).toMatch(/^(build|context):true$/);
      expect(f.calls()).toHaveLength(mode.length ? 2 : 1);

      writeFileSync(
        f.dest,
        'stale contents that are longer than the inventory itself, to be overwritten',
      );
      expect(await f.run(...mode)).toBe(0);
      expect(readFileSync(f.dest)).toEqual(readFileSync(join(f.widget, 'settings.json')));
    }
  });

  it('fails the build when settings.json cannot be copied', async () => {
    for (const mode of [[], ['--watch']]) {
      const missing = fixture({ withSettings: false });
      expect(await missing.run(...mode)).not.toBe(0);
      expect(missing.calls()).toEqual([]);
      expect(existsSync(missing.dest)).toBe(false);

      // A regular file where the dist directory belongs cannot be written into, even as root.
      const blocked = fixture();
      writeFileSync(join(blocked.widget, 'dist'), 'not a directory');
      expect(await blocked.run(...mode)).not.toBe(0);
      expect(blocked.calls()).toEqual([]);
    }
  });
});
