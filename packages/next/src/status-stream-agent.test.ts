// a change of agent.json pushes a snapshot to clients that asked for items.

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSession } from '@passback/adapters/local';
import { createStatusHub } from './status-stream';
import type { ItemsMessage } from './status-stream';

const WORKING: AgentSession = {
  state: 'working',
  agent: 'claude-code',
  since: '2026-10-27T10:00:00.000Z',
};
const ROWS = { items: [], truncated: false };

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met within 5 s');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('status hub agent session', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-agent-'));
    await mkdir(path.join(root, '.passback', 'outbox'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('pushes a snapshot with the agent session when the session watcher reports a change', async () => {
    let onChange: () => void = () => {};
    const watchSession = vi.fn((_dir: string, cb: () => void) => {
      onChange = cb;
      return () => {};
    });
    const hub = createStatusHub(root, {
      pollMs: 1000,
      debounceMs: 20,
      list: async () => ROWS,
      agent: async () => WORKING,
      watchSession,
    });
    const sent: ItemsMessage[] = [];
    const off = hub.subscribe(
      () => {},
      (m) => sent.push(m),
    );
    onChange();
    onChange();
    onChange();
    await until(() => sent.length === 1);
    await wait(60);
    expect(sent).toEqual([{ v: 1, ...ROWS, agent: WORKING }]);
    off();
  });

  it('starts the session watcher with the first items client and closes it with the last', () => {
    const close = vi.fn();
    const watchSession = vi.fn<(dir: string, cb: () => void) => () => void>(() => close);
    const hub = createStatusHub(root, { pollMs: 1000, watchSession });
    const plain = hub.subscribe(() => {});
    expect(watchSession).not.toHaveBeenCalled();
    const first = hub.subscribe(
      () => {},
      () => {},
    );
    const second = hub.subscribe(
      () => {},
      () => {},
    );
    expect(watchSession).toHaveBeenCalledTimes(1);
    expect(watchSession.mock.calls[0]![0]).toBe(path.join(root, '.passback'));
    first();
    expect(close).not.toHaveBeenCalled();
    second();
    expect(close).toHaveBeenCalledTimes(1);
    plain();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
