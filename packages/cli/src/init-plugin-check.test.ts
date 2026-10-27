import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runInit } from './init-run';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const VITE = '@passback/vite-plugin';
const NEXT = '@passback/next';

const NEXT_LINE = (dir: string): string =>
  `${dir}: ${VITE} is installed for a Next app; run: npm uninstall ${VITE} && npm i -D ${NEXT}`;
const VITE_LINE = (dir: string): string =>
  `${dir}: ${NEXT} is installed for a Vite app; run: npm uninstall ${NEXT} && npm i -D ${VITE}`;

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function project(files: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'passback-plugin-check-'));
  tmpDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    await writeFile(path.join(root, rel), text, 'utf8');
  }
  return root;
}

function pkg(deps: Record<string, string>, field = 'dependencies'): { name: string } {
  return { name: 'app', [field]: deps } as { name: string };
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    const full = path.join(entry.parentPath, entry.name);
    const rel = path.relative(root, full);
    out[rel] = entry.isDirectory() ? '<dir>' : await readFile(full, 'utf8');
  }
  return out;
}

const mismatchLines = (printed: string[]): string[] =>
  printed.filter((l) => l.includes(' is installed for a '));

describe('init plugin check', () => {
  it('reports both plugin mismatch directions in preview', async () => {
    const cases: [Record<string, unknown>, string[]][] = [
      [pkg({ next: '15', [VITE]: '1' }), [NEXT_LINE('.')]],
      [pkg({ next: '15' }, 'dependencies'), []],
      [{ name: 'a', devDependencies: { next: '15', [VITE]: '1' } }, [NEXT_LINE('.')]],
      [pkg({ vite: '6', [NEXT]: '1' }), [VITE_LINE('.')]],
      [{ name: 'a', devDependencies: { vite: '6', [NEXT]: '1' } }, [VITE_LINE('.')]],
      [pkg({ vite: '6', react: '19', [NEXT]: '1' }), [VITE_LINE('.')]],
      [{ name: 'a', devDependencies: { vite: '6', react: '19', [NEXT]: '1' } }, [VITE_LINE('.')]],
      [pkg({ next: '15', [VITE]: '1', [NEXT]: '1' }), [NEXT_LINE('.')]],
      [pkg({ vite: '6', [VITE]: '1', [NEXT]: '1' }), [VITE_LINE('.')]],
    ];
    for (const [packageJson, expected] of cases) {
      const root = await project({ 'package.json': packageJson });
      const result = await runInit(root);
      expect(mismatchLines(result.printed)).toEqual(expected);
    }
  });

  it('refuses apply before any project writes', async () => {
    for (const [deps, line] of [
      [{ next: '15', [VITE]: '1' }, NEXT_LINE('.')],
      [{ vite: '6', [NEXT]: '1' }, VITE_LINE('.')],
    ] as const) {
      const root = await project({
        'package.json': pkg({ ...deps }),
        '.gitignore': 'node_modules\n',
        'AGENTS.md': '# mine\n',
      });
      const before = await snapshot(root);
      await expect(
        runInit(root, { apply: true, agents: ['claude', 'codex', 'cursor'] }),
      ).rejects.toThrow(line);
      expect(await snapshot(root)).toEqual(before);
    }
  });

  it('checks only targeted workspace apps before applying', async () => {
    const files = {
      'package.json': { name: 'ws', workspaces: ['apps/*'] },
      'apps/web/package.json': pkg({ next: '15', [VITE]: '1' }),
      'apps/site/package.json': pkg({ vite: '6', [NEXT]: '1' }),
      'apps/ok/package.json': pkg({ vite: '6', [VITE]: '1' }),
      'apps/lib/package.json': pkg({ [NEXT]: '1' }),
    };
    const root = await project(files);
    const preview = await runInit(root);
    expect(mismatchLines(preview.printed)).toEqual([VITE_LINE('apps/site'), NEXT_LINE('apps/web')]);
    const before = await snapshot(root);

    // one bad app among the selected blocks every selected app
    await expect(runInit(root, { apply: true, apps: ['apps/ok', 'apps/web'] })).rejects.toThrow(
      NEXT_LINE('apps/web'),
    );
    await expect(runInit(root, { apply: true, apps: ['apps/web', 'apps/site'] })).rejects.toThrow(
      `${NEXT_LINE('apps/web')}\n${VITE_LINE('apps/site')}`,
    );
    expect(await snapshot(root)).toEqual(before);

    // --app excludes the mismatched apps; framework none is not a mismatch
    const only = await runInit(root, { apply: true, apps: ['apps/ok', 'apps/lib'] });
    expect(mismatchLines(only.printed)).toEqual([]);
    expect(only.written.length).toBeGreaterThan(0);

    // no workspace apps: the root manifest is the target
    const single = await project({ 'package.json': pkg({ next: '15', [VITE]: '1' }) });
    await expect(runInit(single, { apply: true })).rejects.toThrow(NEXT_LINE('.'));
  });

  it('preserves init behavior without a plugin mismatch', async () => {
    const manifests: Record<string, unknown>[] = [
      pkg({ next: '15', [NEXT]: '1' }),
      pkg({ vite: '6', react: '19', [VITE]: '1' }),
      pkg({ next: '15' }),
      pkg({ vite: '6' }),
      pkg({}),
      pkg({ [VITE]: '1', [NEXT]: '1' }),
      { name: 'a', dependencies: [VITE], devDependencies: 'next' },
      { name: 'a', dependencies: null, devDependencies: { vite: '6' } },
      { name: 'a', dependencies: { next: '15' }, devDependencies: [NEXT, VITE] },
    ];
    for (const packageJson of manifests) {
      const root = await project({ 'package.json': packageJson });
      const preview = await runInit(root);
      expect(mismatchLines(preview.printed)).toEqual([]);
      const applied = await runInit(root, { apply: true });
      expect(mismatchLines(applied.printed)).toEqual([]);
      expect(applied.framework).toBe(preview.framework);
    }
  });

  it('exits one with the repair command for a plugin mismatch', async () => {
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: packageDir });
    for (const [deps, line] of [
      [{ next: '15', [VITE]: '1' }, NEXT_LINE('.')],
      [{ vite: '6', [NEXT]: '1' }, VITE_LINE('.')],
    ] as const) {
      const root = await project({ 'package.json': pkg({ ...deps }), 'README.md': 'hi\n' });
      const before = await snapshot(root);
      const run = spawnSync(
        process.execPath,
        [path.join(packageDir, 'dist/bin.js'), 'init', '--apply', '--root', root],
        { encoding: 'utf8' },
      );
      expect(run.status).toBe(1);
      expect(run.stderr.trim()).toBe(line);
      expect(await snapshot(root)).toEqual(before);
    }
  }, 60_000);
});
