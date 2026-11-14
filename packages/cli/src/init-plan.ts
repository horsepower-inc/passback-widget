import type { DetectedFramework } from './detect-framework';
import { detectFramework } from './detect-framework';
import type { AgentId } from './agent-select';
import { mergeAgentsSnippet } from './agents-snippet';
import { CLAUDE_COMMAND_PATH, CLAUDE_COMMAND_TEXT } from './claude-command';
import {
  CODEX_CONFIG_PATH,
  CODEX_SKILL_PATH,
  CODEX_SKILL_TEXT,
  mergeCodexConfig,
} from './codex-files';
import {
  CURSOR_MCP_PATH,
  CURSOR_SKILL_PATH,
  CURSOR_SKILL_TEXT,
  mergeCursorMcp,
} from './cursor-files';
import { mergeMcpConfig } from './mcp-config';
import { planNextApp } from './next-files';
import type { NextAppInput } from './next-files';

export interface InitInput {
  packageJson: unknown;
  mcpJson?: string;
  agentsMd?: string;
  agents?: AgentId[];
  claudeCommand?: string;
  codexConfig?: string;
  codexSkill?: string;
  cursorMcp?: string;
  cursorSkill?: string;
  nextApps?: NextAppInput[];
  gitignore?: string;
}

export interface InitWrite {
  path: string;
  text: string;
}

export interface InitPlan {
  framework: DetectedFramework;
  dirs: string[];
  writes: InitWrite[];
  printed: string[];
}

/** Pure composition of framework detection and the MCP/AGENTS.md merges into one write plan. */
export function planInit(input: InitInput): InitPlan {
  const plan: InitPlan = {
    framework: detectFramework(input.packageJson),
    dirs: ['.passback/inbox', '.passback/outbox'],
    writes: [],
    printed: [],
  };

  planRootMcp(input, plan);
  mergeOrReport(plan, 'AGENTS.md', AGENTS_FIX, () => mergeAgentsSnippet(input.agentsMd));

  if (input.agents?.includes('claude') && input.claudeCommand === undefined) {
    plan.writes.push({ path: CLAUDE_COMMAND_PATH, text: CLAUDE_COMMAND_TEXT });
  }

  if (input.agents?.includes('codex')) {
    planCodex(input, plan);
  }

  if (input.agents?.includes('cursor')) {
    planCursor(input, plan);
  }

  for (const app of (input.nextApps ?? []).map(planNextApp)) {
    plan.writes.push(...app.writes);
    plan.printed.push(...app.printed);
  }
  planGitignore(plan, input.gitignore);
  if (input.agents?.includes('claude') && /^\s*\/?\.mcp\.json\s*$/m.test(input.gitignore ?? '')) {
    plan.printed.push(MCP_IGNORED_LINE);
  }
  return plan;
}

const MCP_IGNORED_LINE =
  '.mcp.json is in .gitignore, so a fresh clone has no passback server; run: claude mcp add --scope project passback -- npx passback dev';

const MCP_FIX =
  'make it a JSON object with "mcpServers": { "passback": { "command": "npx", "args": ["passback", "dev"] } }';
const AGENTS_FIX =
  'keep one <!-- passback:start --> line followed by one <!-- passback:end --> line, or delete both';

/** Plans the merged file, or prints how to fix it when the merge finds it invalid. */
function mergeOrReport(
  plan: InitPlan,
  path: string,
  fix: string,
  merge: () => { changed: boolean; text: string },
): void {
  try {
    const { changed, text } = merge();
    if (changed) plan.writes.push({ path, text });
  } catch (err) {
    if (!(err instanceof Error && err.message.startsWith('invalid '))) throw err;
    plan.printed.push(
      `${path} left as it is (${err.message}). Fix: ${fix}, then run npx passback init again.`,
    );
  }
}

function planGitignore(plan: InitPlan, text = ''): void {
  if (!/^\s*\/?\.passback\/?\s*$/m.test(text)) {
    plan.writes.push({
      path: '.gitignore',
      text: `${text.trim() && text.replace(/[\r\n]*$/, '\n')}.passback/\n`,
    });
  }
}

/** The root .mcp.json is Claude's: merged when claude is selected or no selection was given. */
function planRootMcp(input: InitInput, plan: InitPlan): void {
  if (input.agents === undefined || input.agents.includes('claude')) {
    mergeOrReport(plan, '.mcp.json', MCP_FIX, () => mergeMcpConfig(input.mcpJson));
  }
}

function planCodex(input: InitInput, plan: InitPlan): void {
  const codexConfig = mergeCodexConfig(input.codexConfig);
  if (codexConfig.changed) {
    plan.writes.push({ path: CODEX_CONFIG_PATH, text: codexConfig.text });
  }
  if (input.codexSkill === undefined) {
    plan.writes.push({ path: CODEX_SKILL_PATH, text: CODEX_SKILL_TEXT });
  }
}

function planCursor(input: InitInput, plan: InitPlan): void {
  mergeOrReport(plan, CURSOR_MCP_PATH, MCP_FIX, () => mergeCursorMcp(input.cursorMcp));
  if (input.cursorSkill === undefined) {
    plan.writes.push({ path: CURSOR_SKILL_PATH, text: CURSOR_SKILL_TEXT });
  }
}
