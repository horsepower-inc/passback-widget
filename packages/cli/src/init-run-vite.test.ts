import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runInit } from './init-run';

let tmpDir: string;

async function makeProject(): Promise<string> {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'passback-init-run-vite-'));
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

async function writePackageJson(root: string, pkg: unknown): Promise<void> {
  await writeFile(path.join(root, 'package.json'), JSON.stringify(pkg), 'utf8');
}

const DEFINE =
  "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n});\n";

async function makeViteProject(configName: string, config: string): Promise<string> {
  const root = await makeProject();
  await writePackageJson(root, { dependencies: { vite: '5.0.0', react: '18.0.0' } });
  await writeFile(path.join(root, configName), config, 'utf8');
  return root;
}

describe('runInit for a vite project', () => {
  it('adds passback() to the vite.config.ts of a single-package vite project', async () => {
    const root = await makeViteProject('vite.config.ts', DEFINE);

    const result = await runInit(root, { apply: true });

    const text = await readFile(path.join(root, 'vite.config.ts'), 'utf8');
    expect(text).toContain("import passback from '@passback/vite-plugin';");
    expect(text).toContain('plugins: [passback(), react()],');
    expect(result.written).toContain('vite.config.ts');
  });

  it('passes the root to passback() for a vite app in a workspace', async () => {
    const root = await makeProject();
    await writePackageJson(root, { name: 'root' });
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n", 'utf8');
    await mkdir(path.join(root, 'apps/site'), { recursive: true });
    await writePackageJson(path.join(root, 'apps/site'), { dependencies: { vite: '5.0.0' } });
    await writeFile(
      path.join(root, 'apps/site/vite.config.js'),
      'export default {\n  plugins: [],\n};\n',
      'utf8',
    );

    const result = await runInit(root, { apply: true });

    const text = await readFile(path.join(root, 'apps/site/vite.config.js'), 'utf8');
    expect(text).toContain("passback({ root: '../..' })");
    expect(result.written).toContain('apps/site/vite.config.js');
  });

  it('writes no file on a second run', async () => {
    const root = await makeViteProject('vite.config.ts', DEFINE);
    await runInit(root, { apply: true });
    const after = await readFile(path.join(root, 'vite.config.ts'), 'utf8');

    const second = await runInit(root, { apply: true });

    expect(second.written).not.toContain('vite.config.ts');
    expect(await readFile(path.join(root, 'vite.config.ts'), 'utf8')).toBe(after);
  });

  it('leaves an unrecognised vite.config alone and prints the manual line', async () => {
    const config = 'export default defineConfig(config);\n';
    const root = await makeViteProject('vite.config.ts', config);

    const result = await runInit(root, { apply: true });

    expect(await readFile(path.join(root, 'vite.config.ts'), 'utf8')).toBe(config);
    expect(result.written).not.toContain('vite.config.ts');
    expect(
      result.printed.some((l) => l.includes('left as it is (unrecognised vite.config shape)')),
    ).toBe(true);
  });

  it('wires the plugin into a function-form vite.config.mts', async () => {
    const config =
      "import { defineConfig } from 'vite';\nexport default defineConfig(({ mode }) => ({ plugins: [] }));\n";
    const root = await makeViteProject('vite.config.mts', config);

    await runInit(root, { apply: true });

    const text = await readFile(path.join(root, 'vite.config.mts'), 'utf8');
    expect(text).toContain("import passback from '@passback/vite-plugin';");
    expect(text).toContain('passback()');
  });

  it('prints the install line for a vite app without a config', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { vite: '5.0.0' } });

    const result = await runInit(root, { apply: true });

    expect(result.printed).toContain(
      ".: no vite.config found; add passback() to its plugins by hand: import passback from '@passback/vite-plugin'",
    );
    expect(result.printed).toContain('.: install it: npm i -D @passback/vite-plugin');
  });
});
