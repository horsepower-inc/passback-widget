import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runInit } from './init-run';

const roots: string[] = [];

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'passback-init-run-head-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const CONFIG = 'export default {\n  plugins: [],\n};\n';

function astroLines(dir: string): string[] {
  return [
    `${dir}: manually edit your layout's <head> (for example src/layouts/Layout.astro); pages show the widget only after this helper call.`,
    `${dir}: import { passbackHeadHtml } from '@passback/vite-plugin/head' in the frontmatter; add <Fragment set:html={passbackHeadHtml()} /> inside <head>.`,
  ];
}

describe('runInit head instructions', () => {
  it('prints Astro instructions without writing framework files in either apply mode', async () => {
    const results = [];
    for (const apply of [false, true]) {
      const root = await makeProject();
      await writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ devDependencies: { vite: '5.0.0', astro: '4.0.0' } }),
        'utf8',
      );
      await writeFile(path.join(root, 'vite.config.js'), CONFIG, 'utf8');

      const result = await runInit(root, { apply });

      expect(result.printed.slice(-2)).toEqual(astroLines('.'));
      expect(result.framework).toBe('vite');
      const paths = [...result.written, ...result.planned.map((p) => p.path)];
      expect(paths.some((p) => /layout/i.test(p))).toBe(false);
      await expect(stat(path.join(root, 'src'))).rejects.toMatchObject({ code: 'ENOENT' });
      results.push({ result, text: await readFile(path.join(root, 'vite.config.js'), 'utf8') });
    }
    const [dry, applied] = results;
    expect(dry?.result.planned.map((p) => p.path)).toContain('vite.config.js');
    expect(dry?.result.written).not.toContain('vite.config.js');
    expect(dry?.text).toBe(CONFIG);
    expect(applied?.result.written).toContain('vite.config.js');
    expect(applied?.text).toContain('passback()');
  });

  it('uses each selected Vite app package for head instructions', async () => {
    const root = await makeProject();
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'root' }), 'utf8');
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n", 'utf8');
    for (const [name, deps] of [
      ['docs', { vite: '5.0.0', astro: '4.0.0' }],
      ['site', { vite: '5.0.0' }],
    ] as const) {
      const dir = path.join(root, 'apps', name);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'package.json'),
        JSON.stringify({ dependencies: deps }),
        'utf8',
      );
      await writeFile(path.join(dir, 'vite.config.js'), CONFIG, 'utf8');
    }

    const result = await runInit(root);

    const head = result.printed.filter((l) => l.includes('@passback/vite-plugin/head'));
    expect(head).toEqual([astroLines('apps/docs')[1]]);
    expect(result.printed.filter((l) => l.startsWith('apps/docs: manually edit'))).toEqual([
      astroLines('apps/docs')[0],
    ]);
    expect(result.printed.some((l) => l.startsWith('apps/site: manually edit'))).toBe(false);
  });
});
