// end-to-end leak proof — a staging build carries only hash ids and a
// local manifest, a production build carries zero passback bytes.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { passback } from './plugin';
import { jsxProduction, tempRoot } from './widget-test-utils';

function writeProject(): string {
  const root = tempRoot('passback-leak-');
  mkdirSync(join(root, 'src', 'components'), { recursive: true });
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><html><body><script type="module" src="/src/main.tsx"></script></body></html>\n',
  );
  writeFileSync(
    join(root, 'src', 'components', 'PriceTag.tsx'),
    'export function PriceTag() { return <div><span>9</span></div>; }\n',
  );
  writeFileSync(
    join(root, 'src', 'main.tsx'),
    [
      'import { PriceTag } from "./components/PriceTag";',
      'console.log(<main><section><PriceTag /></section><button>Buy</button></main>);',
      '',
    ].join('\n'),
  );
  return root;
}

function readAllFiles(dir: string): string {
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath ?? entry.path, entry.name), 'utf8'))
    .join('\n');
}

describe('leak', () => {
  let stagingRoot: string;
  let productionRoot: string;
  let stagingOutput: string;
  let productionOutput: string;

  beforeAll(async () => {
    stagingRoot = writeProject();
    productionRoot = writeProject();

    await build({
      root: stagingRoot,
      configFile: false,
      ...jsxProduction,
      logLevel: 'silent',
      mode: 'staging',
      plugins: [passback({ buildId: 'leak000', stagingModes: ['staging'] })],
      build: { outDir: 'dist', minify: true },
    });
    await build({
      root: productionRoot,
      configFile: false,
      ...jsxProduction,
      logLevel: 'silent',
      mode: 'production',
      plugins: [passback({ buildId: 'leak000', stagingModes: ['staging'] })],
      build: { outDir: 'dist', minify: true },
    });

    stagingOutput = readAllFiles(join(stagingRoot, 'dist'));
    productionOutput = readAllFiles(join(productionRoot, 'dist'));
  }, 60000);

  afterAll(() => {
    rmSync(stagingRoot, { recursive: true, force: true });
    rmSync(productionRoot, { recursive: true, force: true });
  });

  it('staging build output contains no source path', () => {
    expect(stagingOutput).not.toContain('src/main.tsx');
    expect(stagingOutput).not.toContain('src/components');
    expect(stagingOutput).not.toContain('PriceTag.tsx');
    expect(stagingOutput).not.toContain(stagingRoot);
  });

  it('staging build output carries a data-source hash id on each host element', () => {
    const ids = [...stagingOutput.matchAll(/["'`]data-source["'`]:\s*["'`]([0-9a-f]{8})["'`]/g)];
    expect(ids).toHaveLength(5);
  });

  it('every hash id in the staging build output is a key of the manifest', () => {
    const ids = [
      ...stagingOutput.matchAll(/["'`]data-source["'`]:\s*["'`]([0-9a-f]{8})["'`]/g),
    ].map((m) => m[1]);
    const manifest = JSON.parse(
      readFileSync(join(stagingRoot, '.passback', 'manifest.json'), 'utf8'),
    );
    const entry = manifest.leak000;
    for (const id of ids) {
      expect(Object.keys(entry)).toContain(id);
    }
  });

  it('the manifest resolves each id to a path:line:col under src', () => {
    const manifest = JSON.parse(
      readFileSync(join(stagingRoot, '.passback', 'manifest.json'), 'utf8'),
    );
    const entry = manifest.leak000;
    for (const value of Object.values(entry) as string[]) {
      expect(value).toMatch(/^src\/.+\.tsx:\d+:\d+$/);
    }
  });

  it('staging build injects the build id script', () => {
    const html = readFileSync(join(stagingRoot, 'dist', 'index.html'), 'utf8');
    expect(html).toContain('window.__passback');
    expect(html).toContain('leak000');
  });

  it('a production build contains no passback bytes', () => {
    expect(productionOutput).not.toContain('data-source');
    expect(productionOutput).not.toContain('__passback');
    expect(productionOutput).not.toContain('leak000');
    expect(productionOutput).not.toContain('src/main.tsx');
    expect(productionOutput).not.toContain('PriceTag.tsx');
    expect(existsSync(join(productionRoot, '.passback', 'manifest.json'))).toBe(false);
  });
});
