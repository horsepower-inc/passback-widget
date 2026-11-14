import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runInit } from './init-run';

let tmpDir: string;

async function makeProject(): Promise<string> {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'passback-init-run-next-'));
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

const ROUTE = 'apps/web/app/api/passback/[[...path]]/route.ts';

const LAYOUT = `import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

async function makeWorkspace(configText: string): Promise<string> {
  const root = await makeProject();
  await writePackageJson(root, { name: 'root' });
  await writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n", 'utf8');
  await mkdir(path.join(root, 'apps/web'), { recursive: true });
  await writePackageJson(path.join(root, 'apps/web'), { dependencies: { next: '14.0.0' } });
  await writeFile(path.join(root, 'apps/web/next.config.ts'), configText, 'utf8');
  return root;
}

describe('runInit for next apps', () => {
  it('wraps the config and writes the route file of a next app in a workspace', async () => {
    const root = await makeWorkspace('const config = {};\nexport default withNextIntl(config);\n');

    const result = await runInit(root, { apply: true });

    const config = await readFile(path.join(root, 'apps/web/next.config.ts'), 'utf8');
    expect(config).toContain("withNextIntl(withPassback(config, { root: '../..' }))");
    await expect(readFile(path.join(root, ROUTE), 'utf8')).resolves.toContain(
      '@passback/next/route',
    );
    expect(result.written).toContain('apps/web/next.config.ts');
    expect(result.written).toContain(ROUTE);
  });

  it('wraps and writes the route file of a single-package next project at its root', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { next: '14.0.0' } });
    await writeFile(path.join(root, 'next.config.js'), 'module.exports = {};\n', 'utf8');

    const result = await runInit(root, { apply: true });

    const config = await readFile(path.join(root, 'next.config.js'), 'utf8');
    expect(config).toContain('withPassback(');
    expect(config).toContain("root: '.'");
    expect(result.written).toContain('next.config.js');
    expect(result.written).toContain('app/api/passback/[[...path]]/route.ts');
  });

  it('returns the layout and install lines for each next app in printed', async () => {
    const root = await makeWorkspace('export default {};\n');
    await mkdir(path.join(root, 'apps/auth'), { recursive: true });
    await writePackageJson(path.join(root, 'apps/auth'), { dependencies: { next: '14.0.0' } });

    const result = await runInit(root, { apply: true });

    for (const dir of ['apps/web', 'apps/auth']) {
      expect(result.printed.some((l) => l.startsWith(`${dir}: add <Passback />`))).toBe(true);
      expect(result.printed).toContain(`${dir}: install it: npm i -D @passback/next`);
    }
  });

  it('writes no file on a second run', async () => {
    const root = await makeWorkspace('export default {};\n');
    await runInit(root, { apply: true });

    const second = await runInit(root, { apply: true });

    expect(second.written).toEqual([]);
    expect(second.printed.length).toBeGreaterThan(0);
  });

  it('leaves an unrecognised next.config alone and prints the manual line', async () => {
    const text = 'const a = 1;\n';
    const root = await makeWorkspace(text);

    const result = await runInit(root, { apply: true });

    await expect(readFile(path.join(root, 'apps/web/next.config.ts'), 'utf8')).resolves.toBe(text);
    expect(result.printed.some((l) => l.includes('next.config left as it is'))).toBe(true);
    expect(result.written).toContain(ROUTE);
  });

  it('puts the route under src/app when the app keeps its code in src', async () => {
    const root = await makeWorkspace('export default {};\n');
    await mkdir(path.join(root, 'apps/web/src/app'), { recursive: true });

    const result = await runInit(root, { apply: true });

    expect(result.written).toContain('apps/web/src/app/api/passback/[[...path]]/route.ts');
    expect(result.written).not.toContain(ROUTE);
  });

  it('adds <Passback /> to the root layout of a next app and writes nothing on a second run', async () => {
    const root = await makeWorkspace('export default {};\n');
    await mkdir(path.join(root, 'apps/web/app'), { recursive: true });
    await writeFile(path.join(root, 'apps/web/app/layout.tsx'), LAYOUT, 'utf8');

    const result = await runInit(root, { apply: true });

    const layout = await readFile(path.join(root, 'apps/web/app/layout.tsx'), 'utf8');
    expect(layout).toContain('<Passback />');
    expect(layout).toContain("import { Passback } from '@passback/next';");
    expect(result.written).toContain('apps/web/app/layout.tsx');
    expect(result.printed.some((l) => l.startsWith('apps/web: add <Passback />'))).toBe(false);
    expect((await runInit(root, { apply: true })).written).toEqual([]);
  });

  it('reads the layout from src/app when the app keeps its code in src', async () => {
    const root = await makeWorkspace('export default {};\n');
    await mkdir(path.join(root, 'apps/web/src/app'), { recursive: true });
    await writeFile(path.join(root, 'apps/web/src/app/layout.tsx'), LAYOUT, 'utf8');

    const result = await runInit(root, { apply: true });

    expect(result.written).toContain('apps/web/src/app/layout.tsx');
  });
});
