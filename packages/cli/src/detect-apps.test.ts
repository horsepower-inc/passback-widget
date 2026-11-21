import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanApps, workspacePatterns } from './detect-apps';

let tmpDir: string | undefined;

async function makeRoot(): Promise<string> {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'passback-detect-apps-'));
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

async function writePkg(root: string, dir: string, pkg: unknown): Promise<void> {
  await mkdir(path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, dir, 'package.json'), JSON.stringify(pkg), 'utf8');
}

const YAML = (lines: string[]): string => `packages:\n${lines.map((l) => `  - ${l}`).join('\n')}\n`;

describe('workspacePatterns', () => {
  it('reads the packages list of pnpm-workspace.yaml and drops negated patterns', () => {
    const yaml = YAML(["'apps/*'", '"packages/*"', 'tools', "'!**/test/**'"]);
    expect(workspacePatterns(yaml, { workspaces: ['ignored/*'] })).toEqual([
      'apps/*',
      'packages/*',
      'tools',
    ]);
  });

  it('reads the workspaces array and the workspaces.packages list of package.json', () => {
    expect(workspacePatterns(undefined, { workspaces: ['apps/*', '!apps/old'] })).toEqual([
      'apps/*',
    ]);
    expect(workspacePatterns('other: 1\n', { workspaces: { packages: ['web'] } })).toEqual(['web']);
  });
});

describe('scanApps', () => {
  it('lists each workspace app with its detected framework, sorted by directory', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), YAML(["'apps/*'", 'tools']), 'utf8');
    await writePkg(root, 'apps/web', { dependencies: { next: '14.0.0' } });
    await writePkg(root, 'apps/admin', { dependencies: { vite: '5.0.0', react: '18.0.0' } });
    await writePkg(root, 'tools', {});

    expect(await scanApps(root)).toEqual([
      { dir: 'apps/admin', framework: 'vite-react' },
      { dir: 'apps/web', framework: 'next' },
      { dir: 'tools', framework: 'none' },
    ]);

    await writeFile(path.join(root, 'pnpm-workspace.yaml'), YAML(["'./*'"]), 'utf8');
    await writePkg(root, 'site', { dependencies: { next: '14.0.0' } });

    expect(await scanApps(root)).toEqual([
      { dir: 'site', framework: 'next' },
      { dir: 'tools', framework: 'none' },
    ]);

    await writeFile(path.join(root, 'pnpm-workspace.yaml'), YAML(["'*'"]), 'utf8');

    expect(await scanApps(root)).toEqual([]);
  });

  it('skips a matched directory without a package.json', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), YAML(["'apps/*'"]), 'utf8');
    await writePkg(root, 'apps/web', { dependencies: { next: '14.0.0' } });
    await mkdir(path.join(root, 'apps/empty'), { recursive: true });
    await writeFile(path.join(root, 'apps/file.txt'), 'x', 'utf8');
    await mkdir(path.join(root, 'apps/broken'), { recursive: true });
    await writeFile(path.join(root, 'apps/broken/package.json'), '{nope', 'utf8');

    expect(await scanApps(root)).toEqual([{ dir: 'apps/web', framework: 'next' }]);
  });

  it('takes the --app directories instead of scanning when they are given', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), YAML(["'apps/*'"]), 'utf8');
    await writePkg(root, 'apps/web', { dependencies: { next: '14.0.0' } });
    await writePkg(root, 'apps/admin', { dependencies: { vite: '5.0.0' } });

    expect(await scanApps(root, { only: ['apps/web', 'apps/admin'] })).toEqual([
      { dir: 'apps/web', framework: 'next' },
      { dir: 'apps/admin', framework: 'vite' },
    ]);
  });

  it('throws naming the directory when an --app directory has no package.json', async () => {
    const root = await makeRoot();

    await expect(scanApps(root, { only: ['apps/nope'] })).rejects.toThrow(
      '--app apps/nope: no package.json in apps/nope',
    );
  });

  it('returns an empty list for a project that is not a workspace', async () => {
    const root = await makeRoot();
    await writePkg(root, '.', { dependencies: { next: '14.0.0' } });

    expect(await scanApps(root)).toEqual([]);
  });
});
