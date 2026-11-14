import { describe, expect, it } from 'vitest';
import { nextSteps } from './next-steps';

const CLAUDE =
  'Claude Code: Restart Claude Code in the project, approve the passback server in /mcp, then type /passback.';
const CODEX =
  'Codex: Restart Codex in the project, approve project trust if prompted, then type $passback.';
const CURSOR =
  'Cursor: Restart Cursor in the project, enable passback in Settings > MCP and approve any connection prompt, then type /passback.';
const FALLBACK =
  'Other agents: Add the MCP server npx passback dev, then ask your agent to call passback_wait.';
const APPLY = 'Check the files above, then run npx passback init --apply to write them.';

describe('nextSteps', () => {
  it('returns each selected agent hint in input order', () => {
    expect(nextSteps(['claude'])).toEqual([CLAUDE, FALLBACK]);
    expect(nextSteps(['codex'])).toEqual([CODEX, FALLBACK]);
    expect(nextSteps(['cursor'])).toEqual([CURSOR, FALLBACK]);
    expect(nextSteps(['claude', 'codex'])).toEqual([CLAUDE, CODEX, FALLBACK]);
    expect(nextSteps(['cursor', 'claude', 'codex'])).toEqual([CURSOR, CLAUDE, CODEX, FALLBACK]);
  });

  it('returns only the fallback when no agents are wired', () => {
    expect(nextSteps([])).toEqual([FALLBACK]);
  });

  it('says to run init --apply when files were only planned', () => {
    expect(nextSteps(['claude', 'codex'], true)).toEqual([APPLY]);
    expect(nextSteps([], true)).toEqual([APPLY]);
    expect(nextSteps(['claude', 'codex', 'cursor'], true)).toEqual([APPLY]);
  });
});
