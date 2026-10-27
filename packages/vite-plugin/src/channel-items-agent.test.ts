// The agent session rides in every passback:items snapshot and a session change schedules a push.

import type { AgentSession } from '@passback/adapters/local';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createItemsPush } from './channel-items';

const EMPTY = { items: [], truncated: false };
const WAITING: AgentSession = {
  state: 'waiting',
  agent: 'claude',
  since: '2026-10-27T10:00:00.000Z',
};

describe('createItemsPush agent session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function make(session: AgentSession = WAITING) {
    const sent: unknown[] = [];
    const close = vi.fn();
    let change: () => void = () => {};
    const agent = vi.fn(async () => session);
    const watchSession = vi.fn((_dir: string, onChange: () => void) => {
      change = onChange;
      return close;
    });
    const push = createItemsPush({
      passbackDir: '/p',
      broadcast: (m) => sent.push(m),
      log: () => {},
      list: async () => EMPTY,
      agent,
      watchSession,
    });
    return { push, sent, close, agent, watchSession, change: () => change() };
  }

  it('adds the agent session to every snapshot', async () => {
    const { push, sent, agent, watchSession } = make();
    expect(watchSession).toHaveBeenCalledWith('/p', expect.any(Function));
    await expect(push.snapshot()).resolves.toEqual({ v: 1, ...EMPTY, agent: WAITING });
    push.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(agent).toHaveBeenCalledWith('/p');
    expect(sent).toEqual([{ v: 1, ...EMPTY, agent: WAITING }]);
  });

  it('schedules one snapshot for several session changes inside the debounce window', async () => {
    const { sent, change } = make();
    change();
    await vi.advanceTimersByTimeAsync(50);
    change();
    change();
    await vi.advanceTimersByTimeAsync(49);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(60);
    expect(sent).toEqual([{ v: 1, ...EMPTY, agent: WAITING }]);
  });

  it('closes the session watcher on stop and sends nothing after it', async () => {
    const { push, sent, close, change } = make();
    change();
    push.stop();
    expect(close).toHaveBeenCalledTimes(1);
    change();
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).toEqual([]);
  });
});
