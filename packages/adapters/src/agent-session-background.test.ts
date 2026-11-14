import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAgentSession } from './agent-session';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const MIN = 60 * 1000;
const iso = (ago: number): string => new Date(NOW - ago).toISOString();
const opts = { now: () => NOW, alive: () => true };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-session-bg-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(value: unknown): void {
  writeFileSync(join(dir, 'agent.json'), JSON.stringify(value));
}

function file(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { agent: 'claude', pid: 4242, waitingSince: null, at: iso(MIN), ...over };
}

describe('readAgentSession background', () => {
  it('reads background true for a waiting and for a working file', async () => {
    const since = iso(5 * MIN);
    write(file({ waitingSince: since, background: true }));
    expect(await readAgentSession(dir, opts)).toEqual({
      state: 'waiting',
      agent: 'claude',
      since,
      background: true,
    });
    const at = iso(MIN);
    write(file({ at, background: true }));
    expect(await readAgentSession(dir, opts)).toEqual({
      state: 'working',
      agent: 'claude',
      since: at,
      background: true,
    });
  });

  it('adds no background key for a file without it or with a value that is not true', async () => {
    const since = iso(5 * MIN);
    for (const over of [{}, { background: false }, { background: 'yes' }, { background: 1 }]) {
      write(file({ waitingSince: since, ...over }));
      const waiting = await readAgentSession(dir, opts);
      expect(waiting).toEqual({ state: 'waiting', agent: 'claude', since });
      expect('background' in waiting).toBe(false);
      write(file(over));
      const working = await readAgentSession(dir, opts);
      expect(working.state).toBe('working');
      expect('background' in working).toBe(false);
    }
  });

  it('never reports background for an absent session', async () => {
    write(file({ waitingSince: iso(MIN), background: true }));
    expect(await readAgentSession(dir, { ...opts, alive: () => false })).toEqual({
      state: 'absent',
    });
    write(file({ at: iso(30 * MIN + 1), background: true }));
    expect(await readAgentSession(dir, opts)).toEqual({ state: 'absent' });
    write(file({ agent: '', background: true }));
    expect(await readAgentSession(dir, opts)).toEqual({ state: 'absent' });
  });
});
