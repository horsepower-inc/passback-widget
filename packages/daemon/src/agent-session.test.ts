import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentSession } from './agent-session';
import { FakeClock } from './core/fake-clock';

const START = Date.parse('2026-10-27T10:00:00.000Z');

describe('createAgentSession', () => {
  let dir: string;
  let clock: FakeClock;

  const read = async () => JSON.parse(await readFile(path.join(dir, 'agent.json'), 'utf8'));
  const make = () => createAgentSession({ dir, clock, pid: 4242, agent: () => 'claude-code' });

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-agent-'));
    clock = new FakeClock(START);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('writes waiting with the agent, the pid and the start time, then working when the wait ends', async () => {
    const session = make();

    await session.waiting();
    const at = new Date(START).toISOString();
    expect(await read()).toEqual({ agent: 'claude-code', pid: 4242, waitingSince: at, at });
    expect((await readFile(path.join(dir, 'agent.json'), 'utf8')).endsWith('\n')).toBe(true);

    clock.advance(5000);
    await session.working();
    expect(await read()).toEqual({
      agent: 'claude-code',
      pid: 4242,
      waitingSince: null,
      at: new Date(START + 5000).toISOString(),
    });
  });

  it('stays waiting until the last of two overlapping waits has ended', async () => {
    const session = make();
    const first = new Date(START).toISOString();

    await session.waiting();
    clock.advance(1000);
    await session.waiting();
    expect((await read()).waitingSince).toBe(first);

    clock.advance(1000);
    await session.working();
    expect((await read()).waitingSince).toBe(first);

    clock.advance(1000);
    await session.working();
    expect((await read()).waitingSince).toBeNull();
  });

  it('replaces the file atomically and leaves no temporary file behind', async () => {
    const session = make();

    await Promise.all([session.waiting(), session.working(), session.waiting()]);

    expect(await readdir(dir)).toEqual(['agent.json']);
    expect((await read()).waitingSince).toBe(new Date(START).toISOString());
  });

  it('never rejects when the directory cannot be written', async () => {
    const blocker = path.join(dir, 'blocker');
    await writeFile(blocker, 'a file, not a directory');
    const session = createAgentSession({
      dir: path.join(blocker, '.passback'),
      clock,
      pid: 1,
      agent: () => 'x',
    });

    await expect(session.waiting()).resolves.toBeUndefined();
    await expect(session.working()).resolves.toBeUndefined();
  });
});
