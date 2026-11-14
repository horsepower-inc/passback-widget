// the snapshot is the rows, truncated and the agent session in one message.

import { describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '@passback/adapters/local';
import { readSnapshot } from './snapshot';

const SESSION: AgentSession = {
  state: 'waiting',
  agent: 'claude-code',
  since: '2026-10-27T10:00:00.000Z',
};

describe('readSnapshot', () => {
  it('returns the rows, truncated and the agent session in one message', async () => {
    const items = [{ id: 'a' }];
    const list = vi.fn(async () => ({ items, truncated: true }));
    const agent = vi.fn(async () => SESSION);
    const snapshot = await readSnapshot({
      passbackDir: '/p/.passback',
      list: list as never,
      agent,
    });
    expect(snapshot).toEqual({ v: 1, items, truncated: true, agent: SESSION });
    expect(snapshot.items).toBe(items);
    expect(list).toHaveBeenCalledWith('/p/.passback');
    expect(agent).toHaveBeenCalledWith('/p/.passback');
  });

  it('rejects when the list rejects and never returns an empty snapshot', async () => {
    const list = vi.fn(async () => {
      throw new Error('disk');
    });
    await expect(
      readSnapshot({
        passbackDir: '/p/.passback',
        list,
        agent: async () => ({ state: 'absent' }),
      }),
    ).rejects.toThrow('disk');
  });
});
