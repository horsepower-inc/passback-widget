import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runInit } from './init-run';

let tmpDir: string;

async function makeProject(): Promise<string> {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'passback-init-closing-'));
  await writeFile(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({ dependencies: { vite: '5.0.0', react: '18.0.0' } }),
    'utf8',
  );
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

describe('runInit closing lines', () => {
  it('closes with the --apply line when files were only planned', async () => {
    const root = await makeProject();

    const result = await runInit(root, {});

    expect(result.planned.length).toBeGreaterThan(0);
    expect(result.nextSteps).toEqual([
      'Check the files above, then run npx passback init --apply to write them.',
    ]);
  });

  it('closes applied init with ordered agent hints and the fallback', async () => {
    const root = await makeProject();

    const result = await runInit(root, { apply: true, agents: ['cursor', 'claude', 'codex'] });

    expect(result.planned).toEqual([]);
    expect(result.nextSteps).toEqual([
      'Cursor: Restart Cursor in the project, enable passback in Settings > MCP and approve any connection prompt, then type /passback.',
      'Claude Code: Restart Claude Code in the project, approve the passback server in /mcp, then type /passback.',
      'Codex: Restart Codex in the project, approve project trust if prompted, then type $passback.',
      'Other agents: Add the MCP server npx passback dev, then ask your agent to call passback_wait.',
    ]);
  });
});
