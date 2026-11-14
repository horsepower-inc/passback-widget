import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runInit } from './init-run';

let tmpDir: string;

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('runInit without apply', () => {
  it('writes only the passback directories and .gitignore without apply', async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'passback-init-run-default-'));
    const config =
      "import { defineConfig } from 'vite';\n\nexport default defineConfig({\n  plugins: [],\n});\n";
    await writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { vite: '5.0.0' } }),
      'utf8',
    );
    await writeFile(path.join(tmpDir, 'vite.config.ts'), config, 'utf8');

    const result = await runInit(tmpDir, { agents: ['claude'] });

    expect(result.written).toEqual(['.gitignore']);
    expect(result.planned.map((w) => w.path)).toEqual(
      expect.arrayContaining(['.mcp.json', 'AGENTS.md', 'vite.config.ts']),
    );
    expect(await readFile(path.join(tmpDir, 'vite.config.ts'), 'utf8')).toBe(config);
    await expect(stat(path.join(tmpDir, '.mcp.json'))).rejects.toThrow();
    await expect(stat(path.join(tmpDir, 'AGENTS.md'))).rejects.toThrow();
    expect((await stat(path.join(tmpDir, '.passback'))).isDirectory()).toBe(true);
    expect(await readFile(path.join(tmpDir, '.gitignore'), 'utf8')).toContain('.passback');
  });
});
