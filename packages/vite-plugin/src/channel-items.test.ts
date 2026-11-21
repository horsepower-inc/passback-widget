// "Inbox list, items and verdict". createItemsPush debounces snapshot pushes.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { InboxRow } from '@passback/adapters/local';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createItemsPush } from './channel-items';

type Listed = { items: InboxRow[]; truncated: boolean };

const EMPTY: Listed = { items: [], truncated: false };

describe('createItemsPush', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function make(list: (dir: string) => Promise<Listed>) {
    const sent: unknown[] = [];
    const logs: string[] = [];
    const push = createItemsPush({
      passbackDir: '/p',
      broadcast: (m) => sent.push(m),
      log: (m) => logs.push(m),
      list,
      agent: async () => ({ state: 'absent' }),
      watchSession: () => () => {},
    });
    return { push, sent, logs };
  }

  it('sends one snapshot for several changes inside the debounce window', async () => {
    const list = vi.fn(async () => EMPTY);
    const { push, sent } = make(list);
    push.schedule();
    await vi.advanceTimersByTimeAsync(50);
    push.schedule();
    push.schedule();
    await vi.advanceTimersByTimeAsync(49);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(60);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith('/p');
    expect(sent).toEqual([{ v: 1, items: [], truncated: false, agent: { state: 'absent' } }]);
  });

  it('sends a second snapshot for a change that arrives while one is being read', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const list = vi
      .fn<(dir: string) => Promise<Listed>>()
      .mockImplementationOnce(async () => {
        await gate;
        return EMPTY;
      })
      .mockImplementation(async () => ({ items: [], truncated: true }));
    const { push, sent } = make(list);
    push.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(list).toHaveBeenCalledTimes(1);
    push.schedule();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([{ v: 1, items: [], truncated: false, agent: { state: 'absent' } }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(list).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([
      { v: 1, items: [], truncated: false, agent: { state: 'absent' } },
      { v: 1, items: [], truncated: true, agent: { state: 'absent' } },
    ]);
  });

  it('sends nothing and logs when the list rejects', async () => {
    const { push, sent, logs } = make(() => Promise.reject(new Error('EACCES')));
    push.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toEqual([]);
    expect(logs).toEqual(['channel: inbox list failed (EACCES)']);
    await expect(push.snapshot()).resolves.toBeUndefined();
  });

  it('sends nothing after stop', async () => {
    const list = vi.fn(async () => EMPTY);
    const { push, sent } = make(list);
    push.schedule();
    push.stop();
    await vi.advanceTimersByTimeAsync(500);
    push.schedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(list).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('keeps target and iteration statuses in the sent rows', async () => {
    const row = {
      id: '01J8Z3K4M5N6P7Q8R9S0T1V2W3',
      target: { tag: 'button', text: 'Buy' },
      iterations: [{ n: 1, statuses: [{ state: 'queued' }] }],
    } as unknown as InboxRow;
    const { push, sent } = make(async () => ({ items: [row], truncated: false }));
    push.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toEqual([{ v: 1, items: [row], truncated: false, agent: { state: 'absent' } }]);
    expect((await push.snapshot())?.items[0]).toBe(row);
  });

  it('logs and resolves undefined when the default list cannot read the inbox', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'passback-items-'));
    try {
      writeFileSync(path.join(dir, 'inbox'), 'not a directory');
      const logs: string[] = [];
      const push = createItemsPush({
        passbackDir: dir,
        broadcast: () => {},
        log: (m) => logs.push(m),
      });
      await expect(push.snapshot()).resolves.toBeUndefined();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatch(/^channel: inbox list failed \(.*ENOTDIR/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sends an empty snapshot when the default list finds no inbox yet', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'passback-items-'));
    try {
      const logs: string[] = [];
      const push = createItemsPush({
        passbackDir: dir,
        broadcast: () => {},
        log: (m) => logs.push(m),
      });
      await expect(push.snapshot()).resolves.toEqual({
        v: 1,
        items: [],
        truncated: false,
        agent: { state: 'absent' },
      });
      expect(logs).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
