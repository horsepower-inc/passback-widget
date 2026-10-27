import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, cp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = fileURLToPath(new URL('..', import.meta.url));

describe('packages/cli build', () => {
  it('emits dist/index.js and dist/index.d.ts with no .ts imports', () => {
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: packageDir });

    const indexJs = path.join(packageDir, 'dist/index.js');
    const indexDts = path.join(packageDir, 'dist/index.d.ts');
    expect(existsSync(indexJs)).toBe(true);
    expect(existsSync(indexDts)).toBe(true);
  }, 60_000);

  it('has no .ts import specifier in dist/index.js', async () => {
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: packageDir });

    const contents = await readFile(path.join(packageDir, 'dist/index.js'), 'utf8');
    expect(contents).not.toMatch(/from\s+['"][^'"]*\.ts['"]/);
  }, 60_000);

  it('runs from a customer install (dist + package.json copied into node_modules)', async () => {
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: packageDir });

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'passback-cli-install-'));
    try {
      const installDir = path.join(tmpDir, 'node_modules/passback');
      await mkdir(installDir, { recursive: true });
      await cp(path.join(packageDir, 'package.json'), path.join(installDir, 'package.json'));
      await cp(path.join(packageDir, 'dist'), path.join(installDir, 'dist'), { recursive: true });

      execFileSync(process.execPath, ['--input-type=module', '-e', "await import('passback')"], {
        cwd: tmpDir,
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('packs only dist, README.md, LICENSE and package.json', () => {
    const files = packFiles();

    for (const file of files) {
      expect(
        file === 'README.md' ||
          file === 'LICENSE' ||
          file === 'package.json' ||
          file.startsWith('dist/'),
        file,
      ).toBe(true);
    }
    for (const required of [
      'README.md',
      'LICENSE',
      'package.json',
      'dist/bin.js',
      'dist/index.js',
    ]) {
      expect(files).toContain(required);
    }
  }, 60_000);

  it('packs a dist/bin.js with a node shebang and under 250000 bytes', async () => {
    packFiles();

    const bin = await readFile(path.join(packageDir, 'dist/bin.js'), 'utf8');
    expect(bin.startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(Buffer.byteLength(bin)).toBeLessThan(250_000);
  }, 60_000);

  it('packs a manifest with no workspace: or file: range in its runtime dependencies', async () => {
    packFiles();

    const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const range of Object.values<string>(manifest[field] ?? {})) {
        expect(range).not.toMatch(/^(workspace|file):/);
      }
    }
    expect(manifest.name).toBe('passback');
    expect(manifest).not.toHaveProperty('private');
  }, 60_000);
});

function packFiles(): string[] {
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: packageDir });
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: packageDir,
    encoding: 'utf8',
  });
  return JSON.parse(out)[0].files.map((f: { path: string }) => f.path);
}
