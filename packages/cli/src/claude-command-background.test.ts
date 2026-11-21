import { describe, expect, it } from 'vitest';
import { CLAUDE_COMMAND_TEXT } from './claude-command';

const flat = (text: string): string => text.replace(/\s+/g, ' ');
const text = flat(CLAUDE_COMMAND_TEXT);

describe('claude command background sub-agent', () => {
  it('tells the agent to start one background sub-agent that waits with background true', () => {
    expect(text).toContain('start exactly one now (never a second)');
    expect(text).toContain('`passback_wait({ timeoutSec: 120, background: true })`');
    expect(text).toContain('sections 5 to 9');
    expect(text).toContain('Passback is running in the background');
    expect(text).toContain('reports `failed` through `passback_status`');
    expect(text.indexOf('background: true')).toBeLessThan(
      text.indexOf('From here the session is a loop'),
    );
  });

  it('says what to do when no background sub-agent is possible', () => {
    expect(text).toContain('If you cannot start a background sub-agent');
    expect(text).toContain('cannot call the `passback_*` tools');
    expect(text).toContain('run the loop yourself as below');
  });

  it('keeps the one-outstanding-wait sentence and the hosted section', () => {
    expect(text).toContain('exactly one outstanding `passback_wait({ timeoutSec: 120 })` call');
    expect(text.split('passback_wait({ timeoutSec: 120 })').length - 1).toBe(1);
    const lastCancel = CLAUDE_COMMAND_TEXT.indexOf('## 9. Developer cancellation');
    expect(lastCancel).toBeGreaterThan(CLAUDE_COMMAND_TEXT.indexOf('background: true'));
    expect(CLAUDE_COMMAND_TEXT.slice(lastCancel)).toContain('loop made unless the developer');
  });
});
