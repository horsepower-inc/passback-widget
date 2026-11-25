import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { explainAgents, parseAgentList, selectAgents } from './agent-select';
import { runInit } from './init-run';

describe('selectAgents', () => {
  it('selects agents from root markers with directory precedence', () => {
    expect(selectAgents({})).toEqual(['claude']);
    expect(selectAgents({ markers: [] })).toEqual(['claude']);
    expect(selectAgents({ markers: ['.claude/'] })).toEqual(['claude']);
    expect(selectAgents({ markers: ['.codex/'] })).toEqual(['codex']);
    expect(selectAgents({ markers: ['.agents/'] })).toEqual(['codex']);
    expect(selectAgents({ markers: ['.cursor/'] })).toEqual(['cursor']);
    expect(selectAgents({ markers: ['.codex/', '.agents/'] })).toEqual(['codex']);
    expect(selectAgents({ markers: ['.cursor/', '.agents/', '.claude/'] })).toEqual([
      'claude',
      'codex',
      'cursor',
    ]);
    expect(selectAgents({ markers: ['.mcp.json'] })).toEqual(['claude']);
    expect(selectAgents({ markers: ['AGENTS.md'] })).toEqual(['codex']);
    expect(selectAgents({ markers: ['.mcp.json', 'AGENTS.md'] })).toEqual(['claude', 'codex']);
    expect(selectAgents({ markers: ['.mcp.json', 'AGENTS.md', '.cursor/'] })).toEqual(['cursor']);
    expect(selectAgents({ flag: ['cursor', 'claude'], markers: ['.codex/'] })).toEqual([
      'cursor',
      'claude',
    ]);
  });

  it('returns a new list each time', () => {
    const first = selectAgents({});
    const second = selectAgents({});
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it('explains each selected agent', () => {
    expect(explainAgents({})).toEqual(['agents: claude (fallback: no agent markers found)']);
    expect(explainAgents({ flag: ['codex', 'claude'] })).toEqual([
      'agents: codex (--agents)',
      'agents: claude (--agents)',
    ]);
    expect(explainAgents({ markers: ['.agents/', '.codex/', '.cursor/', 'AGENTS.md'] })).toEqual([
      'agents: codex (detected: .codex/, .agents/)',
      'agents: cursor (detected: .cursor/)',
    ]);
    expect(explainAgents({ markers: ['AGENTS.md', '.mcp.json'] })).toEqual([
      'agents: claude (detected: .mcp.json)',
      'agents: codex (detected: AGENTS.md)',
    ]);
  });
});

describe('runInit agent detection', () => {
  let dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs = [];
  });

  async function project(files: Record<string, string>, subdirs: string[] = []) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'passback-agent-select-'));
    dirs.push(root);
    await writeFile(path.join(root, 'package.json'), '{}', 'utf8');
    for (const d of subdirs) await mkdir(path.join(root, d), { recursive: true });
    for (const [f, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, f)), { recursive: true });
      await writeFile(path.join(root, f), text, 'utf8');
    }
    return root;
  }

  it('detects root agents through init without adding agents on repeat runs', async () => {
    const single: [string, string][] = [
      ['.claude', 'claude'],
      ['.codex', 'codex'],
      ['.agents', 'codex'],
      ['.cursor', 'cursor'],
    ];
    for (const [dir, id] of single) {
      const root = await project({}, [dir]);
      expect((await runInit(root)).agents).toEqual([id]);
    }

    const mixed = await project({ 'AGENTS.md': '' }, ['.cursor', '.claude', '.codex', '.agents']);
    const first = await runInit(mixed);
    expect(first.agents).toEqual(['claude', 'codex', 'cursor']);
    expect(first.printed.slice(0, 3)).toEqual([
      'agents: claude (detected: .claude/)',
      'agents: codex (detected: .codex/, .agents/)',
      'agents: cursor (detected: .cursor/)',
    ]);

    const files = await project({ '.mcp.json': '', 'AGENTS.md': '' });
    expect((await runInit(files)).agents).toEqual(['claude', 'codex']);

    const markerFile = await project({ '.cursor': '' });
    await expect(runInit(markerFile)).rejects.toThrow('ENOTDIR');

    const fallback = await runInit(await project({}));
    expect(fallback.agents).toEqual(['claude']);
    expect(fallback.printed[0]).toBe('agents: claude (fallback: no agent markers found)');

    const nested = await project({ 'apps/web/package.json': '{}' }, ['apps/web/.cursor']);
    expect((await runInit(nested)).agents).toEqual(['claude']);

    const explicit = await project({}, ['.claude']);
    const all = await runInit(explicit, { agents: ['claude', 'codex', 'cursor'] });
    expect(all.agents).toEqual(['claude', 'codex', 'cursor']);
    expect(all.printed[1]).toBe('agents: codex (--agents)');

    const malformed = await project({ '.mcp.json': 'nope', '.cursor/mcp.json': 'nope' });
    const codexOnly = await runInit(malformed, { apply: true, agents: ['codex'] });
    expect(codexOnly.written).toContain('.codex/config.toml');
    expect(await readFile(path.join(malformed, '.mcp.json'), 'utf8')).toBe('nope');
    expect(await readFile(path.join(malformed, '.cursor/mcp.json'), 'utf8')).toBe('nope');
    expect(codexOnly.printed.join('\n')).not.toContain('left as it is');

    const dry = await project({}, ['.claude']);
    const live = await project({}, ['.claude']);
    const planned = await runInit(dry);
    const applied = await runInit(live, { apply: true });
    expect(planned.agents).toEqual(applied.agents);
    expect(planned.printed.slice(0, 1)).toEqual(applied.printed.slice(0, 1));
    await expect(readFile(path.join(dry, 'AGENTS.md'), 'utf8')).rejects.toThrow();

    const repeat = await project({}, ['.claude']);
    await runInit(repeat, { apply: true });
    const again = await runInit(repeat, { apply: true });
    expect(again.agents).toEqual(['claude']);
    expect(again.written).toEqual([]);
  });
});

describe('parseAgentList', () => {
  it('parses all as every agent', () => {
    expect(parseAgentList('all')).toEqual(['claude', 'codex', 'cursor']);
  });

  it('drops duplicate names and keeps the first order', () => {
    expect(parseAgentList('cursor,claude,cursor')).toEqual(['cursor', 'claude']);
  });

  it('rejects an unknown or empty agent name', () => {
    expect(parseAgentList('claude,vim')).toEqual({ error: 'claude,vim' });
    expect(parseAgentList('')).toEqual({ error: '' });
  });
});
