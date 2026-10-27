import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const widgetDist = fileURLToPath(new URL('../../widget/dist/', import.meta.url));
const dist = (file: string): string => path.join(packageDir, 'dist', file);

const BUILTINS = new Set(builtinModules);

function runNode(code: string, env: Record<string, string> = {}): string {
  return execFileSync(process.execPath, ['-e', code], {
    cwd: packageDir,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, NODE_ENV: 'production', ...env },
  });
}

function bareSpecifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const found = new Set<string>();
  const patterns = [
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /^(?:import|export)\b[^\n;]*?\bfrom\s*["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /^import\s*["']([^"']+)["']/gm,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) found.add(match[1] ?? '');
  }
  return [...found].filter((spec) => !spec.startsWith('.') && !path.isAbsolute(spec));
}

function allowed(spec: string): boolean {
  if (spec.startsWith('node:')) return true;
  if (BUILTINS.has(spec)) return true;
  return /^(next|react)(\/|$)/.test(spec);
}

beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: packageDir, stdio: 'inherit' });
}, 180_000);

describe('packages/next build', () => {
  it('emits both module formats of the index and the route, the loader and their declarations', () => {
    for (const file of [
      'index.js',
      'index.cjs',
      'route.js',
      'route.cjs',
      'loader.cjs',
      'index.d.ts',
      'route.d.ts',
      'loader.d.ts',
    ]) {
      expect(existsSync(dist(file)), file).toBe(true);
    }
  });

  it('bundles every workspace package and imports nothing but node builtins, next and react', () => {
    const files = readdirSync(path.join(packageDir, 'dist')).filter((name) => /\.c?js$/.test(name));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const name of files) {
      const bad = bareSpecifiers(dist(name)).filter((spec) => !allowed(spec));
      expect(bad, name).toEqual([]);
    }
  });

  it('copies the widget bundle and the collector chunk into dist/widget byte for byte', () => {
    for (const file of ['passback.js', 'passback-local.js', 'passback-collect.js']) {
      const copied = readFileSync(dist(`widget/${file}`));
      const original = readFileSync(path.join(widgetDist, file));
      expect(copied.equals(original)).toBe(true);
    }
  });

  it('copies the shot chunk into dist/widget byte for byte', () => {
    const copied = readFileSync(dist('widget/passback-shot.js'));
    const original = readFileSync(path.join(widgetDist, 'passback-shot.js'));
    expect(copied.equals(original)).toBe(true);
  });

  it('loads the loader in plain node as a function that adds data-source', () => {
    const out = runNode(`
      const loader = require('./dist/loader.cjs');
      if (typeof loader !== 'function') throw new Error('loader is ' + typeof loader);
      const root = process.cwd();
      const file = root + '/src/App.tsx';
      let result;
      loader.call(
        {
          resourcePath: file,
          getOptions: () => ({ root }),
          callback: (err, code) => { if (err) throw err; result = code; },
        },
        'export const App = () => <div>hi</div>;',
      );
      process.stdout.write(result);
    `);
    expect(out).toContain('data-source');
  });

  it('lets withPassback find the built loader.cjs from the CommonJS build in a development process', () => {
    const out = runNode(
      `
      const { withPassback } = require('./dist/index.cjs');
      const config = withPassback({});
      const rules = config.turbopack.rules['*.tsx'];
      process.stdout.write(rules[0].loaders[0].loader);
    `,
      { NODE_ENV: 'development', PASSBACK_ROOT: packageDir },
    );
    expect(out).toBe(dist('loader.cjs'));
    expect(existsSync(out)).toBe(true);
  });

  it('serves the widget bytes from dist/widget through the built CommonJS route', () => {
    const out = runNode(
      `
      const { GET } = require('./dist/route.cjs');
      GET(new Request('http://localhost/api/passback/widget.js'), {
        params: Promise.resolve({ path: ['widget.js'] }),
      }).then(async (res) => {
        if (res.status !== 200) throw new Error('status ' + res.status + ' ' + (await res.text()));
        process.stdout.write(Buffer.from(await res.arrayBuffer()).toString('base64'));
      });
    `,
      { PASSBACK_MODE: 'dev', PASSBACK_ROOT: packageDir },
    );
    const original = readFileSync(dist('widget/passback-local.js'));
    expect(Buffer.from(out, 'base64').equals(original)).toBe(true);
  });

  it('points every runtime path of the exports map at a file the build emitted', () => {
    const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
      main: string;
      exports: Record<string, string | Record<string, string>>;
    };
    const runtime = (entry: string | Record<string, string>): string[] =>
      typeof entry === 'string'
        ? [entry]
        : Object.entries(entry)
            .filter(([condition]) => condition !== 'types')
            .map(([, target]) => target);
    const paths = [manifest.main, ...Object.values(manifest.exports).flatMap(runtime)];
    expect(paths.length).toBe(6);
    for (const target of paths) {
      expect(target).toMatch(/^\.\/dist\//);
      expect(existsSync(path.join(packageDir, target)), target).toBe(true);
    }
  });
});
