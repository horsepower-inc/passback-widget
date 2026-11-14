import { describe, expect, it } from 'vitest';
import { planInit } from './init-plan';

describe('planInit', () => {
  it('plans the mcp config and the agents snippet for a fresh project', () => {
    const plan = planInit({ packageJson: { dependencies: { vite: '5.0.0', react: '18.0.0' } } });
    expect(plan.writes.map((write) => write.path)).toEqual([
      '.mcp.json',
      'AGENTS.md',
      '.gitignore',
    ]);
  });

  it('reports the detected framework', () => {
    const plan = planInit({ packageJson: { dependencies: { next: '14.0.0' } } });
    expect(plan.framework).toBe('next');
  });

  it('leaves out a write whose file is already up to date', () => {
    const existingMcp = JSON.stringify({
      mcpServers: { passback: { command: 'passback', args: ['dev'] } },
    });
    const plan = planInit({
      packageJson: { dependencies: { vite: '5.0.0' } },
      mcpJson: existingMcp,
    });
    expect(plan.writes.map((write) => write.path)).toEqual(['AGENTS.md', '.gitignore']);
  });

  it('lists the passback directories to create', () => {
    const plan = planInit({ packageJson: {} });
    expect(plan.dirs).toEqual(['.passback/inbox', '.passback/outbox']);
  });

  it('still plans the writes for a project with no vite or next', () => {
    const plan = planInit({ packageJson: { dependencies: { react: '18.0.0' } } });
    expect(plan.framework).toBe('none');
    expect(plan.writes.map((write) => write.path)).toEqual([
      '.mcp.json',
      'AGENTS.md',
      '.gitignore',
    ]);
  });

  it('plans .claude/commands/passback.md when claude is selected', () => {
    const plan = planInit({ packageJson: {}, agents: ['claude'] });
    expect(plan.writes.map((write) => write.path)).toEqual([
      '.mcp.json',
      'AGENTS.md',
      '.claude/commands/passback.md',
      '.gitignore',
    ]);
  });

  it('plans no claude command when claude is not selected', () => {
    const plan = planInit({ packageJson: {}, agents: ['codex'] });
    expect(plan.writes.map((write) => write.path)).not.toContain('.claude/commands/passback.md');
  });

  it('plans the codex config and skill when codex is selected', () => {
    const plan = planInit({ packageJson: {}, agents: ['codex'] });
    expect(plan.writes.map((write) => write.path)).toEqual([
      'AGENTS.md',
      '.codex/config.toml',
      '.agents/skills/passback/SKILL.md',
      '.gitignore',
    ]);
    const config = plan.writes.find((write) => write.path === '.codex/config.toml')!.text;
    expect(config).toContain('tool_timeout_sec = 180');
  });

  it('plans no codex file when codex is not selected', () => {
    const plan = planInit({ packageJson: {}, agents: ['claude'] });
    expect(plan.writes.map((write) => write.path)).not.toContain('.codex/config.toml');
    expect(plan.writes.map((write) => write.path)).not.toContain(
      '.agents/skills/passback/SKILL.md',
    );
  });

  it('leaves an existing claude command file alone', () => {
    const plan = planInit({ packageJson: {}, agents: ['claude'], claudeCommand: 'mine' });
    expect(plan.writes.map((write) => write.path)).toEqual([
      '.mcp.json',
      'AGENTS.md',
      '.gitignore',
    ]);
  });

  it('plans a command text that names the three tools and carries no plugin namespace or repo path', () => {
    const plan = planInit({ packageJson: {}, agents: ['claude'] });
    const text = plan.writes.find((write) => write.path === '.claude/commands/passback.md')!.text;
    for (const needle of ['passback_wait', 'passback_status', 'passback_open', 'mcp__passback__']) {
      expect(text).toContain(needle);
    }
    for (const needle of ['--plugin-dir', '/passback:passback', '@passback/cli']) {
      expect(text).not.toContain(needle);
    }
    expect(text).toContain('claude mcp add --scope project passback -- npx passback dev');
  });

  it('prints the claude mcp add line when .mcp.json is gitignored and claude is selected', () => {
    for (const entry of ['.mcp.json', '/.mcp.json']) {
      const plan = planInit({
        packageJson: {},
        agents: ['claude'],
        gitignore: `node_modules\n  ${entry}  \n`,
      });
      expect(plan.printed).toContain(
        '.mcp.json is in .gitignore, so a fresh clone has no passback server; run: claude mcp add --scope project passback -- npx passback dev',
      );
    }
    expect(
      planInit({ packageJson: {}, agents: ['codex'], gitignore: '.mcp.json\n' }).printed,
    ).toEqual([]);
  });

  it('prints no claude mcp add line when .mcp.json is not gitignored', () => {
    const plan = planInit({ packageJson: {}, agents: ['claude'], gitignore: 'node_modules\n' });
    expect(plan.printed.join('\n')).not.toContain('claude mcp add');
    expect(planInit({ packageJson: {}, agents: ['claude'] }).printed).toEqual([]);
  });

  it('plans the cursor mcp file and skill when cursor is selected', () => {
    const plan = planInit({ packageJson: {}, agents: ['cursor'] });
    expect(plan.writes.map((write) => write.path)).toEqual([
      'AGENTS.md',
      '.cursor/mcp.json',
      '.cursor/skills/passback/SKILL.md',
      '.gitignore',
    ]);
    const mcp = plan.writes.find((write) => write.path === '.cursor/mcp.json')!.text;
    expect(JSON.parse(mcp).mcpServers.passback).toEqual({
      command: 'npx',
      args: ['passback', 'dev'],
    });
  });

  it('leaves root mcp untouched when claude is not selected', () => {
    for (const mcpJson of [undefined, 'not json']) {
      const plan = planInit({ packageJson: {}, agents: ['codex', 'cursor'], mcpJson });
      expect(plan.writes.map((write) => write.path)).not.toContain('.mcp.json');
      expect(plan.writes.map((write) => write.path)).toContain('AGENTS.md');
      expect(plan.printed.join('\n')).not.toContain('.mcp.json');
    }
    const all = planInit({ packageJson: {}, agents: ['claude', 'codex', 'cursor'] });
    expect(all.writes.map((write) => write.path)).toContain('.mcp.json');
  });

  it('plans no cursor file when cursor is not selected', () => {
    const plan = planInit({ packageJson: {}, agents: ['claude'] });
    expect(plan.writes.map((write) => write.path)).not.toContain('.cursor/mcp.json');
    expect(plan.writes.map((write) => write.path)).not.toContain(
      '.cursor/skills/passback/SKILL.md',
    );
  });

  it('reports an invalid .cursor/mcp.json with its fix and plans the other files', () => {
    const plan = planInit({ packageJson: {}, agents: ['cursor'], cursorMcp: 'not json' });
    expect(plan.printed).toHaveLength(1);
    expect(plan.printed[0]).toMatch(
      /^\.cursor\/mcp\.json left as it is \(invalid \.cursor\/mcp\.json: /,
    );
    expect(plan.printed[0]).toContain('then run npx passback init again.');
    expect(plan.writes.map((write) => write.path)).toEqual([
      'AGENTS.md',
      '.cursor/skills/passback/SKILL.md',
      '.gitignore',
    ]);
  });

  it('adds the writes and the printed lines of each next app after the agent writes', () => {
    const plan = planInit({
      packageJson: {},
      agents: ['claude'],
      nextApps: [{ dir: '.', rootRelative: '.', srcApp: false, routeExists: false }],
    });
    expect(plan.writes.map((write) => write.path)).toEqual([
      '.mcp.json',
      'AGENTS.md',
      '.claude/commands/passback.md',
      'app/api/passback/[[...path]]/route.ts',
      'next.config.mjs',
      '.gitignore',
    ]);
    expect(plan.printed).toHaveLength(2);
  });

  it('returns no printed lines when no next app is given', () => {
    expect(planInit({ packageJson: {} }).printed).toEqual([]);
  });

  it('keeps the printed lines of every app in app order', () => {
    const base = { rootRelative: '../..', srcApp: false, routeExists: true };
    const plan = planInit({
      packageJson: {},
      nextApps: [
        { ...base, dir: 'apps/a' },
        { ...base, dir: 'apps/b' },
      ],
    });
    expect(plan.printed.map((line) => line.slice(0, line.indexOf(':')))).toEqual([
      'apps/a',
      'apps/a',
      'apps/b',
      'apps/b',
    ]);
  });

  it('reports an invalid .mcp.json with its fix and plans the other files', () => {
    const plan = planInit({ packageJson: {}, mcpJson: 'not json' });
    expect(plan.printed).toEqual([
      '.mcp.json left as it is (invalid .mcp.json: not valid JSON). Fix: make it a JSON object with "mcpServers": { "passback": { "command": "npx", "args": ["passback", "dev"] } }, then run npx passback init again.',
    ]);
    expect(plan.writes.map((write) => write.path)).toEqual(['AGENTS.md', '.gitignore']);
  });

  it('reports AGENTS.md markers out of order with their fix', () => {
    const plan = planInit({
      packageJson: {},
      agentsMd: '<!-- passback:end -->\n<!-- passback:start -->\n',
    });
    expect(plan.printed).toHaveLength(1);
    expect(plan.printed[0]).toMatch(/^AGENTS\.md left as it is \(invalid AGENTS\.md: /);
    expect(plan.printed[0]).toContain(
      'Fix: keep one <!-- passback:start --> line followed by one <!-- passback:end --> line, or delete both, then run npx passback init again.',
    );
    expect(plan.writes.map((write) => write.path)).toEqual(['.mcp.json', '.gitignore']);
  });

  it('plans .passback/ in a new .gitignore', () => {
    for (const gitignore of [undefined, '', '\n  \n']) {
      const plan = planInit({ packageJson: {}, gitignore });
      expect(plan.writes.at(-1)).toEqual({ path: '.gitignore', text: '.passback/\n' });
    }
  });

  it('appends .passback/ to an existing .gitignore once', () => {
    for (const gitignore of ['node_modules', 'node_modules\n', 'node_modules\n\n\n']) {
      const plan = planInit({ packageJson: {}, gitignore });
      expect(plan.writes.at(-1)).toEqual({
        path: '.gitignore',
        text: 'node_modules\n.passback/\n',
      });
    }
  });

  it('leaves a .gitignore that already ignores .passback alone', () => {
    for (const entry of ['.passback', '.passback/', '/.passback', '/.passback/']) {
      const plan = planInit({ packageJson: {}, gitignore: `node_modules\n  ${entry}  \n` });
      expect(plan.writes.map((write) => write.path)).not.toContain('.gitignore');
    }
  });
});
