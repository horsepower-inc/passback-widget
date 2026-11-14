import { describe, expect, it } from 'vitest';
import { agentLine } from './agent-line';

describe('agentLine', () => {
  it('names the waiting and the working agent and maps the known client names', () => {
    const at = (state: string, agent: string) => agentLine({ state, agent, since: 'now' });
    expect(at('waiting', 'claude-code')).toEqual({ state: 'waiting', text: 'Claude Code waiting' });
    expect(at('working', 'Claude')).toEqual({ state: 'working', text: 'Claude Code working' });
    expect(at('waiting', 'codex-cli')?.text).toBe('Codex waiting');
    expect(at('working', 'CURSOR')?.text).toBe('Cursor working');
    expect(at('waiting', 'zed')?.text).toBe('zed waiting');
  });

  it('says there is no agent session when the state is absent', () => {
    expect(agentLine({ state: 'absent' })).toEqual({
      state: 'absent',
      text: 'No agent session: type /passback',
    });
  });

  it('gives nothing for a snapshot without an agent or with a wrong shape', () => {
    for (const raw of [
      undefined,
      null,
      'waiting',
      42,
      {},
      { state: 'waiting' },
      { state: 'working', agent: '' },
      { state: 'working', agent: 7 },
      { state: 'sleeping', agent: 'claude' },
    ]) {
      expect(agentLine(raw)).toBeUndefined();
    }
  });
});
