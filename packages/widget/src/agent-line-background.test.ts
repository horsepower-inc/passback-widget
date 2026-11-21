import { describe, expect, it } from 'vitest';
import { agentLine } from './agent-line';

describe('agentLine background', () => {
  it('adds (background) to a waiting and a working agent that runs in the background', () => {
    const at = (state: string) => agentLine({ state, agent: 'claude-code', background: true });
    expect(at('waiting')).toEqual({ state: 'waiting', text: 'Claude Code waiting (background)' });
    expect(at('working')).toEqual({ state: 'working', text: 'Claude Code working (background)' });
  });

  it('adds nothing for background false, a non-boolean value or no key', () => {
    for (const background of [false, 'true', 1, null, {}]) {
      expect(agentLine({ state: 'waiting', agent: 'codex', background })?.text).toBe(
        'Codex waiting',
      );
    }
    expect(agentLine({ state: 'working', agent: 'codex' })?.text).toBe('Codex working');
  });

  it('never adds it to an absent session', () => {
    expect(agentLine({ state: 'absent', background: true })).toEqual({
      state: 'absent',
      text: 'No agent session: type /passback',
    });
  });
});
