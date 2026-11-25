import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentId } from './agent-select';
import { runInit } from './init-run';

const ALL: AgentId[] = ['claude', 'codex', 'cursor'];
let tmpDir: string;

async function makeProject(): Promise<string> {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'passback-init-run-'));
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

describe('runInit', () => {
  it('creates the passback directories and writes .mcp.json and AGENTS.md in a fresh project', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { vite: '5.0.0', react: '18.0.0' } });

    await runInit(root, { apply: true });

    const inboxStat = await readFile(path.join(root, '.mcp.json'), 'utf8');
    expect(inboxStat).toContain('passback');
    const agentsMd = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
    expect(agentsMd).toContain('<!-- passback:start -->');
  });

  it('returns the detected framework and the written paths', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { next: '14.0.0' } });

    const result = await runInit(root, { apply: true, agents: ALL });

    expect(result.framework).toBe('next');
    expect(result.written).toEqual([
      '.mcp.json',
      'AGENTS.md',
      '.claude/commands/passback.md',
      '.codex/config.toml',
      '.agents/skills/passback/SKILL.md',
      '.cursor/mcp.json',
      '.cursor/skills/passback/SKILL.md',
      'app/api/passback/[[...path]]/route.ts',
      'next.config.mjs',
      '.gitignore',
    ]);
  });

  async function makeMonorepo(): Promise<string> {
    const root = await makeProject();
    await writePackageJson(root, { name: 'root' });
    await writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n", 'utf8');
    await mkdir(path.join(root, 'apps/web'), { recursive: true });
    await mkdir(path.join(root, 'apps/site'), { recursive: true });
    await writePackageJson(path.join(root, 'apps/web'), { dependencies: { next: '14.0.0' } });
    await writePackageJson(path.join(root, 'apps/site'), { dependencies: { vite: '5.0.0' } });
    return root;
  }

  it('returns the workspace apps with their frameworks', async () => {
    const root = await makeMonorepo();

    const result = await runInit(root, { apply: true });

    expect(result.apps).toEqual([
      { dir: 'apps/site', framework: 'vite' },
      { dir: 'apps/web', framework: 'next' },
    ]);
    expect(result.written.slice(0, 2)).toEqual(['.mcp.json', 'AGENTS.md']);
  });

  it('returns an empty apps list for a single-package project', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { next: '14.0.0' } });

    const result = await runInit(root, { apply: true });

    expect(result.apps).toEqual([]);
  });

  it('takes the --app directories instead of the workspace scan', async () => {
    const root = await makeMonorepo();

    const result = await runInit(root, { apply: true, apps: ['apps/web'] });

    expect(result.apps).toEqual([{ dir: 'apps/web', framework: 'next' }]);
  });

  it('ends with separate hints for every wired agent and the fallback', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { vite: '5.0.0' } });

    const result = await runInit(root, { apply: true, agents: ALL });

    expect(result.nextSteps).toEqual([
      'Claude Code: Restart Claude Code in the project, approve the passback server in /mcp, then type /passback.',
      'Codex: Restart Codex in the project, approve project trust if prompted, then type $passback.',
      'Cursor: Restart Cursor in the project, enable passback in Settings > MCP and approve any connection prompt, then type /passback.',
      'Other agents: Add the MCP server npx passback dev, then ask your agent to call passback_wait.',
    ]);
  });

  it('ends with only the Codex hint and the fallback for a Codex selection', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { next: '14.0.0' } });

    const result = await runInit(root, { apply: true, agents: ['codex'] });

    expect(result.nextSteps).toEqual([
      'Codex: Restart Codex in the project, approve project trust if prompted, then type $passback.',
      'Other agents: Add the MCP server npx passback dev, then ask your agent to call passback_wait.',
    ]);
  });

  it('writes nothing on a second run', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { vite: '5.0.0' } });

    await runInit(root, { apply: true });
    const result = await runInit(root, { apply: true });

    expect(result.written).toEqual([]);
  });

  it('keeps the servers already in .mcp.json and the text already in AGENTS.md', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { vite: '5.0.0' } });
    const existingMcp = JSON.stringify({
      mcpServers: { other: { command: 'other', args: [] } },
    });
    await writeFile(path.join(root, '.mcp.json'), existingMcp, 'utf8');
    const existingAgents = '# My project\n\nSome notes.\n';
    await writeFile(path.join(root, 'AGENTS.md'), existingAgents, 'utf8');

    await runInit(root, { apply: true });

    const mcpJson = JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf8'));
    expect(mcpJson.mcpServers.other).toEqual({ command: 'other', args: [] });
    expect(mcpJson.mcpServers.passback).toEqual({ command: 'npx', args: ['passback', 'dev'] });
    const agentsMd = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
    expect(agentsMd).toContain('Some notes.');
    expect(agentsMd).toContain('<!-- passback:start -->');
  });

  it('wires only claude when only its directory exists', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { vite: '5.0.0' } });
    await mkdir(path.join(root, '.claude'));

    const result = await runInit(root, { apply: true });

    expect(result.agents).toEqual(['claude']);
    expect(result.written).toContain('.claude/commands/passback.md');
    expect(result.written).not.toContain('.codex/config.toml');
    expect(result.written).not.toContain('.cursor/mcp.json');
    const text = await readFile(path.join(root, '.claude/commands/passback.md'), 'utf8');
    expect(text).toContain('# /passback');
  });

  it('writes the claude command for --agents claude and creates .claude/commands', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { vite: '5.0.0' } });

    const result = await runInit(root, { apply: true, agents: ['claude'] });

    expect(result.written).toContain('.claude/commands/passback.md');
    const text = await readFile(path.join(root, '.claude/commands/passback.md'), 'utf8');
    expect(text).toContain('passback_wait');
  });

  it('falls back to claude when no agent markers exist', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { vite: '5.0.0' } });

    const result = await runInit(root, { apply: true });

    expect(result.agents).toEqual(['claude']);
    expect(result.printed[0]).toBe('agents: claude (fallback: no agent markers found)');
    expect(result.written).toContain('.claude/commands/passback.md');
    expect(result.written).not.toContain('.codex/config.toml');
    expect(result.written).not.toContain('.cursor/mcp.json');
  });

  it('does not overwrite an existing .claude/commands/passback.md', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { vite: '5.0.0' } });
    await mkdir(path.join(root, '.claude/commands'), { recursive: true });
    await writeFile(path.join(root, '.claude/commands/passback.md'), 'mine', 'utf8');

    const result = await runInit(root, { apply: true, agents: ['claude'] });

    expect(result.written).not.toContain('.claude/commands/passback.md');
    expect(await readFile(path.join(root, '.claude/commands/passback.md'), 'utf8')).toBe('mine');
  });

  it('writes the codex config and skill for --agents codex', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { vite: '5.0.0' } });

    const result = await runInit(root, { apply: true, agents: ['codex'] });

    expect(result.written).toContain('.codex/config.toml');
    expect(result.written).toContain('.agents/skills/passback/SKILL.md');
    const config = await readFile(path.join(root, '.codex/config.toml'), 'utf8');
    expect(config).toContain('[mcp_servers.passback]');
    const skill = await readFile(path.join(root, '.agents/skills/passback/SKILL.md'), 'utf8');
    expect(skill).toContain('passback_wait');

    const second = await runInit(root, { apply: true, agents: ['codex'] });
    expect(second.written).toEqual([]);
  });

  it('appends to an existing .codex/config.toml without touching its other tables', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { vite: '5.0.0' } });
    await mkdir(path.join(root, '.codex'));
    const existing = 'model = "x"\n\n[mcp_servers.other]\ncommand = "other"\n';
    await writeFile(path.join(root, '.codex/config.toml'), existing, 'utf8');

    await runInit(root, { apply: true });

    const config = await readFile(path.join(root, '.codex/config.toml'), 'utf8');
    expect(config.startsWith(existing)).toBe(true);
    expect(config).toContain('[mcp_servers.passback]');
    expect(config).toContain('tool_timeout_sec = 180');
  });

  it('writes the cursor mcp file and skill for --agents cursor', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { vite: '5.0.0' } });

    const result = await runInit(root, { apply: true, agents: ['cursor'] });

    expect(result.written).toContain('.cursor/mcp.json');
    expect(result.written).toContain('.cursor/skills/passback/SKILL.md');
    const mcp = JSON.parse(await readFile(path.join(root, '.cursor/mcp.json'), 'utf8'));
    expect(mcp.mcpServers.passback).toEqual({ command: 'npx', args: ['passback', 'dev'] });
    const skill = await readFile(path.join(root, '.cursor/skills/passback/SKILL.md'), 'utf8');
    expect(skill).toContain('passback_wait');

    const second = await runInit(root, { apply: true, agents: ['cursor'] });
    expect(second.written).toEqual([]);
  });

  it('merges into an existing .cursor/mcp.json and keeps its other servers', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { vite: '5.0.0' } });
    await mkdir(path.join(root, '.cursor'));
    const existing = JSON.stringify({ mcpServers: { other: { command: 'other' } } });
    await writeFile(path.join(root, '.cursor/mcp.json'), existing, 'utf8');

    await runInit(root, { apply: true });

    const mcp = JSON.parse(await readFile(path.join(root, '.cursor/mcp.json'), 'utf8'));
    expect(mcp.mcpServers.other).toEqual({ command: 'other' });
    expect(mcp.mcpServers.passback).toEqual({ command: 'npx', args: ['passback', 'dev'] });
  });

  it('rejects when package.json is missing and creates nothing', async () => {
    const root = await makeProject();

    await expect(runInit(root, { apply: true })).rejects.toThrow(`no package.json in ${root}`);

    await expect(readFile(path.join(root, '.mcp.json'), 'utf8')).rejects.toThrow();
  });

  it('reports an invalid .mcp.json, leaves it as it is and still sets up the rest', async () => {
    const root = await makeProject();
    await writePackageJson(root, { dependencies: { vite: '5.0.0' } });
    await writeFile(path.join(root, '.mcp.json'), 'not json', 'utf8');

    const result = await runInit(root, { apply: true });

    expect(await readFile(path.join(root, '.mcp.json'), 'utf8')).toBe('not json');
    expect(
      result.printed.some((line) => line.startsWith('.mcp.json left as it is (invalid .mcp.json:')),
    ).toBe(true);
    expect(await readFile(path.join(root, '.gitignore'), 'utf8')).toBe('.passback/\n');
  });
});
