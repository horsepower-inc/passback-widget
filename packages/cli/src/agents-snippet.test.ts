import { describe, expect, it } from 'vitest';
import { HOSTED_LINES, SNIPPET_END, SNIPPET_START, mergeAgentsSnippet } from './agents-snippet';
import { CLAUDE_COMMAND_TEXT } from './claude-command';
import { CODEX_SKILL_TEXT } from './codex-files';
import { CURSOR_SKILL_TEXT } from './cursor-files';

describe('mergeAgentsSnippet', () => {
  it('names the hosted commands in the AGENTS.md block', () => {
    const { text } = mergeAgentsSnippet(undefined);
    expect(text).toContain('npx passback login');
    expect(text).toContain('npx passback init --site');
    expect(text).toContain('npx passback connect');
    expect(text).toContain('npx passback site delete');
  });

  it('ends every agent skill with the hosted section', () => {
    for (const text of [CLAUDE_COMMAND_TEXT, CODEX_SKILL_TEXT, CURSOR_SKILL_TEXT]) {
      expect(text).toContain('## Hosted Passback');
      expect(text).toContain('npx passback init --site');
      expect(text.endsWith('named in this conversation.\n')).toBe(true);
    }
  });

  it('tells the agent to connect Linear and GitHub in the browser and to use a key only for Plane or on request', () => {
    const hosted = HOSTED_LINES.join('\n');
    expect(hosted).toContain('npx passback connect linear` (or');
    expect(hosted).toContain('installs the Passback GitHub App');
    expect(hosted).not.toContain('connect linear --key');
    expect(mergeAgentsSnippet(undefined).text).toContain('(the developer approves in the browser)');
  });

  it('creates the text from nothing and from whitespace only', () => {
    const fromNothing = mergeAgentsSnippet(undefined);
    expect(fromNothing.changed).toBe(true);
    expect(fromNothing.text.startsWith(SNIPPET_START)).toBe(true);
    expect(fromNothing.text.endsWith(SNIPPET_END + '\n')).toBe(true);

    const fromWhitespace = mergeAgentsSnippet('   \n\t  ');
    expect(fromWhitespace.changed).toBe(true);
    expect(fromWhitespace.text).toBe(fromNothing.text);
  });

  it('appends the block after existing text with one blank line between', () => {
    const existing = '# My AGENTS.md\n\nSome existing rules.\n';
    const result = mergeAgentsSnippet(existing);
    expect(result.changed).toBe(true);
    expect(result.text).toBe(
      '# My AGENTS.md\n\nSome existing rules.' + '\n\n' + mergeAgentsSnippet(undefined).text,
    );
  });

  it('reports unchanged when the block is already current', () => {
    const first = mergeAgentsSnippet('# My AGENTS.md\n');
    const second = mergeAgentsSnippet(first.text);
    expect(second).toEqual({ changed: false, text: first.text });
  });

  it('rewrites a stale block in place and keeps the text around it', () => {
    const before = '# My AGENTS.md\n\n';
    const after = '\n\n## Other section\nMore text.\n';
    const stale = `${before}${SNIPPET_START}\nstale content\n${SNIPPET_END}${after}`;
    const result = mergeAgentsSnippet(stale);
    const current = mergeAgentsSnippet(undefined).text.replace(/\n$/, '');
    expect(result.text).toBe(`${before}${current}${after}`);
    expect(result.changed).toBe(true);

    const second = mergeAgentsSnippet(result.text);
    expect(second).toEqual({ changed: false, text: result.text });
  });

  it('throws invalid AGENTS.md when the start marker has no end marker', () => {
    expect(() => mergeAgentsSnippet(`# Doc\n${SNIPPET_START}\nbody`)).toThrow(
      /^invalid AGENTS\.md:/,
    );
  });

  it('throws invalid AGENTS.md when the end marker comes before the start marker', () => {
    expect(() => mergeAgentsSnippet(`# Doc\n${SNIPPET_END}\nbody\n${SNIPPET_START}`)).toThrow(
      /^invalid AGENTS\.md:/,
    );
  });

  it('tells the agent to wait for marks only when the developer starts a Passback session', () => {
    const { text } = mergeAgentsSnippet(undefined);
    expect(text).toContain(
      'When the developer starts a Passback session (`/passback` in Claude Code, `$passback` in Codex), call `passback_wait`',
    );
    expect(text).not.toContain('At the start of a session');
  });

  it('tells the agent to agree environments, modes, placement and destination with the developer before editing', () => {
    const { text } = mergeAgentsSnippet(undefined);
    expect(text).toContain('Passback is not set up from a template');
    expect(text).toContain(
      'Before you edit any file, settle with the developer which environments',
    );
    expect(text).toContain('`stagingModes`');
    expect(text).toContain('`corner`');
    expect(text).toContain('where comments go');
    expect(text).toContain('Never just run `npx passback init` and stop.');
    expect(text).toContain('`passback_wait`, fix each mark');
  });

  it('tells the agent to pass --intake for Plane so marks land in Intake', () => {
    const { text } = mergeAgentsSnippet(undefined);
    expect(text).toContain('connect plane --workspace <slug> --key <key> --intake`');
    expect(text).toContain(
      '`--intake` files marks in Plane Intake (use `--no-intake` for work items)',
    );
    expect(HOSTED_LINES.join('\n')).toContain(
      '`plane` also takes `--intake`, which files marks in Intake.',
    );
  });

  it('names passback_wait and passback_status in the block', () => {
    const { text } = mergeAgentsSnippet(undefined);
    expect(text).toContain('passback_wait');
    expect(text).toContain('passback_status');
  });
});
