import { describe, expect, it } from 'vitest';
import { CODEX_SKILL_TEXT, mergeCodexConfig } from './codex-files';

const TABLE =
  '[mcp_servers.passback]\ncommand = "npx"\nargs = ["passback", "dev"]\ntool_timeout_sec = 180\n';

describe('mergeCodexConfig', () => {
  it('creates the config with the passback table from nothing', () => {
    expect(mergeCodexConfig(undefined)).toEqual({ changed: true, text: TABLE });
  });

  it('appends the table after other tables and keeps them byte for byte', () => {
    const existing = 'model = "x"\n\n[mcp_servers.other]\ncommand = "other"\n';
    const result = mergeCodexConfig(existing);
    expect(result.changed).toBe(true);
    expect(result.text).toBe(`${existing}\n${TABLE}`);
  });

  it('leaves the config unchanged when the passback table is already there', () => {
    const existing = '[mcp_servers.passback]\ncommand = "passback"\nargs = ["dev"]\n';
    expect(mergeCodexConfig(existing)).toEqual({ changed: false, text: existing });
  });

  it('leaves the config unchanged when only a passback sub-table is there', () => {
    const existing = '[mcp_servers.passback.env]\nFOO = "1"\n';
    expect(mergeCodexConfig(existing)).toEqual({ changed: false, text: existing });
  });

  it('ends the config with a newline and sets tool_timeout_sec to 180', () => {
    const result = mergeCodexConfig('model = "x"');
    expect(result.text.endsWith('\n')).toBe(true);
    expect(result.text).toContain('tool_timeout_sec = 180\n');
    expect(result.text).toBe(`model = "x"\n\n${TABLE}`);
  });

  it('carries a skill text that names the three tools and no plugin path or repo path', () => {
    for (const tool of ['passback_wait', 'passback_status', 'passback_open']) {
      expect(CODEX_SKILL_TEXT).toContain(tool);
    }
    expect(CODEX_SKILL_TEXT).toContain('npx passback init');
    expect(CODEX_SKILL_TEXT).not.toContain('@passback/cli');
    expect(CODEX_SKILL_TEXT).not.toContain('PATH');
    expect(CODEX_SKILL_TEXT).not.toContain('docs/');
    expect(CODEX_SKILL_TEXT).not.toContain('integrations/');
    expect(CODEX_SKILL_TEXT).not.toContain('this repository');
  });
});
