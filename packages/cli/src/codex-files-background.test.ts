import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLAUDE_COMMAND_TEXT } from './claude-command';
import { CODEX_SKILL_TEXT } from './codex-files';

const flat = (text: string): string => text.replace(/\s+/g, ' ');
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

const PLUGIN_ROOT = '../../../integrations/';

/** The plugin copies, or null when `integrations/` is absent (the public mirror). */
function loadPlugins(root: string): { codex: string; claude: string } | null {
  const codexPath = `${root}codex/.agents/skills/passback/SKILL.md`;
  const claudePath = `${root}claude-code/commands/passback.md`;
  const exists = (path: string): boolean => existsSync(new URL(path, import.meta.url));
  if (!exists(codexPath) || !exists(claudePath)) return null;
  return { codex: read(codexPath), claude: read(claudePath) };
}

const plugins = loadPlugins(PLUGIN_ROOT);

const BACKGROUND_WAIT = '`passback_wait({ timeoutSec: 120, background: true })`';
const LOOP_START = 'From here the session is a loop';

/** The background paragraph: from its opening sentence up to the foreground loop. */
function paragraph(text: string, opening: string): string {
  const flatText = flat(text);
  const start = flatText.indexOf(opening);
  const end = flatText.indexOf(LOOP_START);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return flatText.slice(start, end).trim();
}

const codexParagraph = paragraph(CODEX_SKILL_TEXT, 'If Codex can start a sub-agent');
const claudeParagraph = paragraph(CLAUDE_COMMAND_TEXT, 'If your agent can start a sub-agent');

/**
 * The plugin parity checks against the copies under `root`. When the copies are absent (the public
 * mirror) it calls `skip` and asserts nothing; the parity test passes the test context's skip.
 */
function checkPluginParity(root: string, skip: () => void): void {
  const copies = loadPlugins(root);
  if (!copies) {
    skip();
    return;
  }
  expect(paragraph(copies.codex, 'If Codex can start a sub-agent')).toBe(codexParagraph);
  expect(paragraph(copies.claude, 'If your agent can start a sub-agent')).toBe(claudeParagraph);
}

describe('codex skill background sub-agent', () => {
  it('skips the plugin parity checks when integrations/ is absent', () => {
    let skipped = false;
    checkPluginParity('../../../no-such-integrations-dir/', () => {
      skipped = true;
    });
    expect(skipped).toBe(true);
  });

  it('offers one Codex background worker', () => {
    expect(codexParagraph).toContain(BACKGROUND_WAIT);
    expect(codexParagraph).toContain('start exactly one now (never a second)');
    expect(codexParagraph).toContain('the loop of sections 5 to 8 as its whole job');
    expect(codexParagraph).toContain('Passback is running in the background');
    expect(codexParagraph).toContain('one short sentence');
    expect(CODEX_SKILL_TEXT.split('background: true').length - 1).toBe(1);
  });

  it('keeps plugin paragraphs aligned', (ctx) => {
    checkPluginParity(PLUGIN_ROOT, () => ctx.skip());
  });

  it('preserves the foreground loop and cancellation after background instructions', () => {
    for (const text of plugins ? [CODEX_SKILL_TEXT, plugins.codex] : [CODEX_SKILL_TEXT]) {
      const flatText = flat(text);
      const background = flatText.indexOf('background: true');
      const foreground = flatText.indexOf('`passback_wait({ timeoutSec: 120 })`');
      const cancel = flatText.indexOf('### Developer cancellation');
      expect(background).toBeGreaterThan(-1);
      expect(foreground).toBeGreaterThan(background);
      expect(cancel).toBeGreaterThan(foreground);
      expect(flatText.split('`passback_wait({ timeoutSec: 120 })`').length - 1).toBe(1);
      expect(flatText).toContain('stop polling or stop editing, do so immediately');
    }
  });

  it('keeps the Codex loop in the main conversation when background execution is unavailable', () => {
    expect(codexParagraph).toContain('If you cannot start a background sub-agent');
    expect(codexParagraph).toContain('cannot call the `passback_*` tools');
    expect(codexParagraph).toContain('say so in one short sentence');
    expect(codexParagraph).toContain('run the loop yourself in the main conversation as below');
  });

  it('routes unclear background comments through failed status and reports a final summary', () => {
    expect(codexParagraph).toContain('does not ask the developer anything in the conversation');
    expect(codexParagraph).toContain(
      'reports `failed` through `passback_status` with the question as the message',
    );
    expect(codexParagraph).toContain('reports a short summary to you');
    expect(codexParagraph).toContain('do not assume an idle parent is woken');
  });
});
