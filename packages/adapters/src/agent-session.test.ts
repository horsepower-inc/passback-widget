import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAgentSession, watchAgentSession } from './agent-session';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const MIN = 60 * 1000;
const iso = (ago: number): string => new Date(NOW - ago).toISOString();
const opts = { now: () => NOW, alive: () => true };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-session-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(value: unknown): void {
  writeFileSync(join(dir, 'agent.json'), typeof value === 'string' ? value : JSON.stringify(value));
}

function file(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { agent: 'claude', pid: 4242, waitingSince: null, at: iso(MIN), ...over };
}

describe('readAgentSession', () => {
  it('reads waiting with the agent name and the time the wait began', async () => {
    const since = iso(5 * MIN);
    write(file({ waitingSince: since }));
    expect(await readAgentSession(dir, opts)).toEqual({ state: 'waiting', agent: 'claude', since });
  });

  it('reads working when the wait has ended and the file is at most 30 minutes old', async () => {
    const at = iso(30 * MIN);
    write(file({ at }));
    expect(await readAgentSession(dir, opts)).toEqual({
      state: 'working',
      agent: 'claude',
      since: at,
    });
  });

  it('says absent for a working file older than 30 minutes and still waiting for an old waiting file', async () => {
    write(file({ at: iso(30 * MIN + 1) }));
    expect(await readAgentSession(dir, opts)).toEqual({ state: 'absent' });
    const since = iso(500 * MIN);
    write(file({ waitingSince: since, at: since }));
    expect(await readAgentSession(dir, opts)).toEqual({ state: 'waiting', agent: 'claude', since });
  });

  it('says absent when the pid is not alive', async () => {
    write(file({ waitingSince: iso(MIN) }));
    const alive = vi.fn(() => false);
    expect(await readAgentSession(dir, { ...opts, alive })).toEqual({ state: 'absent' });
    expect(alive).toHaveBeenCalledWith(4242);
  });

  it('says absent for a missing, unparsable or malformed file and never throws', async () => {
    const absent = { state: 'absent' };
    expect(await readAgentSession(join(dir, 'nope'), opts)).toEqual(absent);
    expect(await readAgentSession(dir, opts)).toEqual(absent);
    const bad: unknown[] = [
      'not json',
      '[]',
      'null',
      '3',
      file({ agent: '' }),
      file({ agent: 7 }),
      file({ pid: 0 }),
      file({ pid: 1.5 }),
      file({ pid: '4242' }),
      file({ waitingSince: 'yesterday-ish' }),
      file({ waitingSince: 5 }),
      file({ at: 'nope' }),
      file({ at: undefined }),
    ];
    for (const value of bad) {
      write(value);
      expect(await readAgentSession(dir, opts)).toEqual(absent);
    }
  });

  it('treats the pid of the running test process as alive by default', async () => {
    write(file({ pid: process.pid, waitingSince: iso(MIN) }));
    expect(await readAgentSession(dir, { now: () => NOW })).toMatchObject({ state: 'waiting' });
  });
});

describe('watchAgentSession', () => {
  it('calls onChange when agent.json changes and ignores every other file name', () => {
    let listener: (event: string, name: string | null) => void = () => {};
    const watch = vi.fn((_dir: string, _o: unknown, l: typeof listener) => {
      listener = l;
      return { close: vi.fn(), on: vi.fn() };
    });
    const onChange = vi.fn();
    watchAgentSession(dir, onChange, watch as never);
    expect(watch).toHaveBeenCalledWith(dir, { persistent: false }, expect.any(Function));
    listener('rename', '.agent.json.tmp');
    listener('change', 'inbox');
    listener('change', null);
    listener('change', 'agent.json.bak');
    expect(onChange).not.toHaveBeenCalled();
    listener('rename', 'agent.json');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('returns a no-op closer when the directory cannot be watched and closes the watcher once', () => {
    const throwing = (): never => {
      throw new Error('ENOENT');
    };
    const noop = watchAgentSession(join(dir, 'nope'), vi.fn(), throwing as never);
    expect(() => noop()).not.toThrow();

    const close = vi.fn();
    const on = vi.fn();
    const stop = watchAgentSession(dir, vi.fn(), (() => ({ close, on })) as never);
    stop();
    stop();
    expect(close).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});
