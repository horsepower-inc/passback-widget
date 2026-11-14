import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentSession } from './agent-session';
import { FakeClock } from './core/fake-clock';

const START = Date.parse('2026-10-27T10:00:00.000Z');

describe('createAgentSession background flag', () => {
  let dir: string;
  let clock: FakeClock;

  const read = async () => JSON.parse(await readFile(path.join(dir, 'agent.json'), 'utf8'));
  const make = () => createAgentSession({ dir, clock, pid: 4242, agent: () => 'claude-code' });

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-agent-bg-'));
    clock = new FakeClock(START);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('writes background true after a background wait and keeps it while the agent works', async () => {
    const session = make();

    await session.waiting(true);
    const at = new Date(START).toISOString();
    expect(await read()).toEqual({
      agent: 'claude-code',
      pid: 4242,
      waitingSince: at,
      at,
      background: true,
    });

    clock.advance(5000);
    await session.working();
    expect(await read()).toEqual({
      agent: 'claude-code',
      pid: 4242,
      waitingSince: null,
      at: new Date(START + 5000).toISOString(),
      background: true,
    });
  });

  it('drops the key again after a wait that is not in the background', async () => {
    const session = make();

    await session.waiting(true);
    await session.working();
    await session.waiting(false);
    expect(await read()).not.toHaveProperty('background');

    await session.working();
    expect(await read()).not.toHaveProperty('background');
  });

  it('writes no background key for a wait called without an argument', async () => {
    const session = make();

    await session.waiting();
    expect(await read()).not.toHaveProperty('background');

    await session.working();
    expect(await read()).not.toHaveProperty('background');
  });
});
