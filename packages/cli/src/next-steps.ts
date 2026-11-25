import type { AgentId } from './agent-select';

const HINTS: Record<AgentId, string> = {
  claude:
    'Claude Code: Restart Claude Code in the project, approve the passback server in /mcp, then type /passback.',
  codex:
    'Codex: Restart Codex in the project, approve project trust if prompted, then type $passback.',
  cursor:
    'Cursor: Restart Cursor in the project, enable passback in Settings > MCP and approve any connection prompt, then type /passback.',
};

const FALLBACK =
  'Other agents: Add the MCP server npx passback dev, then ask your agent to call passback_wait.';

/** The lines `passback init` ends with: one start hint per wired agent in input order, then the fallback line, or the one line that says to apply. */
export function nextSteps(agents: readonly AgentId[], planned = false): string[] {
  if (planned) {
    return ['Check the files above, then run npx passback init --apply to write them.'];
  }
  return [...agents.map((agent) => HINTS[agent]), FALLBACK];
}
