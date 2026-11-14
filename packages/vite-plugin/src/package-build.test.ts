import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const widgetDist = fileURLToPath(new URL('../../widget/dist/', import.meta.url));

let tmpDir = '';
let tarEntries: string[] = [];
let packedManifest: {
  main?: string;
  types?: string;
  exports?: Record<string, { types?: string; import?: string }>;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} = {};

beforeAll(async () => {
  await execFileAsync(process.execPath, ['scripts/build.mjs'], {
    cwd: packageDir,
    maxBuffer: 64 * 1024 * 1024,
  });
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'passback-vite-plugin-pack-'));
  await execFileAsync('pnpm', ['pack', '--pack-destination', tmpDir], {
    cwd: packageDir,
    maxBuffer: 64 * 1024 * 1024,
  });
  const tarball = path.join(tmpDir, 'passback-vite-plugin-0.1.5.tgz');
  const listing = await execFileAsync('tar', ['-tzf', tarball], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  tarEntries = listing.stdout.split(/\r?\n/).filter((line) => line !== '' && !line.endsWith('/'));
  const manifest = await execFileAsync('tar', ['-xzOf', tarball, 'package/package.json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  packedManifest = JSON.parse(manifest.stdout);
}, 180_000);

afterAll(async () => {
  if (tmpDir !== '') {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

describe('packages/vite-plugin package build', () => {
  it('emits dist/index.js and dist/index.d.ts', () => {
    expect(existsSync(path.join(packageDir, 'dist/index.js'))).toBe(true);
    expect(existsSync(path.join(packageDir, 'dist/index.d.ts'))).toBe(true);
  });

  it('bundles the workspace packages so dist/index.js imports no @passback package', () => {
    const contents = readFileSync(path.join(packageDir, 'dist/index.js'), 'utf8');
    expect(contents).not.toContain('from "@passback/');
    expect(contents).not.toContain("from '@passback/");
  });

  it('copies the widget bundle and the collector chunk into dist/widget byte for byte', () => {
    for (const file of ['passback.js', 'passback-collect.js']) {
      const copied = readFileSync(path.join(packageDir, 'dist/widget', file));
      const original = readFileSync(path.join(widgetDist, file));
      expect(copied.equals(original)).toBe(true);
    }
  });

  it('copies the local widget bundle into dist/widget byte for byte', () => {
    const copied = readFileSync(path.join(packageDir, 'dist/widget/passback-local.js'));
    const original = readFileSync(path.join(widgetDist, 'passback-local.js'));
    expect(copied.equals(original)).toBe(true);
  });

  it('copies the shot chunk into dist/widget byte for byte', () => {
    const copied = readFileSync(path.join(packageDir, 'dist/widget/passback-shot.js'));
    const original = readFileSync(path.join(widgetDist, 'passback-shot.js'));
    expect(copied.equals(original)).toBe(true);
  });

  it('copies the panel chunk into dist/widget byte for byte', () => {
    const copied = readFileSync(path.join(packageDir, 'dist/widget/passback-panel.js'));
    const original = readFileSync(path.join(widgetDist, 'passback-panel.js'));
    expect(copied.equals(original)).toBe(true);
  });

  it('packs only dist, LICENSE, README.md and package.json, no source and no test file', () => {
    const names = tarEntries.map((entry) => entry.replace(/^package\//, ''));
    expect(names).toContain('LICENSE');
    expect(names).toContain('README.md');
    expect(names).toContain('package.json');
    for (const name of names) {
      expect(
        ['LICENSE', 'README.md', 'package.json'].includes(name) || name.startsWith('dist/'),
      ).toBe(true);
      expect(name).not.toMatch(/\.test\./);
      expect(name).not.toMatch(/(?<!\.d)\.ts$/);
    }
  });

  it('packs the inert head entry declarations and public export', async () => {
    const names = tarEntries.map((entry) => entry.replace(/^package\//, ''));
    expect(names).toContain('dist/head.js');
    expect(names).toContain('dist/head.d.ts');
    expect(packedManifest.exports?.['./head']).toEqual({
      types: './dist/head.d.ts',
      import: './dist/head.js',
    });
    const head = (await import(pathToFileURL(path.join(packageDir, 'dist/head.js')).href)) as {
      passbackHead: () => unknown[];
      passbackHeadHtml: () => string;
    };
    expect(head.passbackHead()).toEqual([]);
    expect(head.passbackHeadHtml()).toBe('');
  });

  it('declares Vite 7 and Vite 8 as the peer range', () => {
    expect(packedManifest.peerDependencies?.vite).toBe('^7.0.0 || ^8.0.0');
  });

  it('packs a manifest whose main, types and exports point into the packed dist and whose dependencies are the three external packages', () => {
    expect(Object.keys(packedManifest.dependencies ?? {}).sort()).toEqual([
      '@babel/parser',
      'magic-string',
      'zod',
    ]);
    expect(packedManifest.peerDependencies?.vite).toBeDefined();
    for (const group of [packedManifest.dependencies, packedManifest.peerDependencies]) {
      expect(Object.keys(group ?? {}).filter((name) => name.startsWith('@passback/'))).toEqual([]);
    }
    expect(packedManifest.private).toBeUndefined();

    const entry = packedManifest.exports?.['.'];
    const named = [packedManifest.main, packedManifest.types, entry?.types, entry?.import];
    const packed = new Set(tarEntries.map((e) => e.replace(/^package\//, '')));
    for (const file of named) {
      expect(file).toBeDefined();
      expect(file).toMatch(/^\.\/dist\//);
      expect(packed.has((file ?? '').replace(/^\.\//, ''))).toBe(true);
    }
  });
});
