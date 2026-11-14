// and the hub pushes passback:items snapshots.

import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelStatus } from '@passback/schema';
import { createStatusHub, eventsResponse } from './status-stream';
import type { ItemsMessage } from './status-stream';

const STATUS: ChannelStatus = {
  v: 1,
  markId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  state: 'running',
  at: '2026-10-01T12:00:00.000Z',
};
const ROWS = { items: [], truncated: false };
const ABSENT = { state: 'absent' } as const;

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met within 5 s');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('status hub items', () => {
  let root: string;
  const outbox = () => path.join(root, '.passback', 'outbox');

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-items-'));
    await mkdir(outbox(), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('pushes one named passback:items frame for several changes inside the debounce window', async () => {
    const list = vi.fn(async () => ROWS);
    const hub = createStatusHub(root, {
      pollMs: 1000,
      debounceMs: 30,
      list,
      agent: async () => ABSENT,
    });
    const controller = new AbortController();
    const res = eventsResponse(
      new Request('http://localhost/events', { signal: controller.signal }),
      hub,
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const pumping = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        text += decoder.decode(value);
      }
    })();
    await until(() => text.startsWith('retry: 1000\n\n'));
    hub.scheduleItems();
    hub.scheduleItems();
    hub.scheduleItems();
    await until(() => text.includes('passback:items'));
    await wait(80);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith(path.join(root, '.passback'));
    expect(text).toBe(
      `retry: 1000\n\nevent: passback:items\ndata: ${JSON.stringify({ v: 1, ...ROWS, agent: ABSENT })}\n\n`,
    );
    controller.abort();
    await pumping;
  });

  it('pushes a snapshot after a relayed status event and keeps the status frame unnamed', async () => {
    const hub = createStatusHub(root, {
      pollMs: 10,
      debounceMs: 10,
      list: async () => ROWS,
      agent: async () => ABSENT,
    });
    const controller = new AbortController();
    const res = eventsResponse(
      new Request('http://localhost/events', { signal: controller.signal }),
      hub,
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const pumping = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        text += decoder.decode(value);
      }
    })();
    await until(() => text.startsWith('retry: 1000\n\n'));
    await writeFile(path.join(outbox(), 'a.tmp'), JSON.stringify(STATUS));
    await rename(path.join(outbox(), 'a.tmp'), path.join(outbox(), 'a.json'));
    await until(() => text.includes('passback:items'));
    expect(text).toContain(`\n\ndata: ${JSON.stringify(STATUS)}\n\n`);
    expect(text).toContain(
      `event: passback:items\ndata: ${JSON.stringify({ v: 1, ...ROWS, agent: ABSENT })}\n\n`,
    );
    expect(text).not.toContain('event: message');
    controller.abort();
    await pumping;
  });

  it('sends nothing when no client asked for items or when the list rejects', async () => {
    const list = vi.fn(async () => ROWS);
    const plain = createStatusHub(root, { pollMs: 1000, debounceMs: 5, list });
    const off = plain.subscribe(() => {});
    plain.scheduleItems();
    await wait(40);
    expect(list).not.toHaveBeenCalled();
    off();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = vi.fn(async () => {
      throw new Error('disk');
    });
    const hub = createStatusHub(root, { pollMs: 1000, debounceMs: 5, list: failing });
    const sent: ItemsMessage[] = [];
    const offItems = hub.subscribe(
      () => {},
      (m) => sent.push(m),
    );
    hub.scheduleItems();
    await until(() => failing.mock.calls.length === 1);
    await wait(40);
    expect(sent).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/^\[passback\] /);
    offItems();
  });

  it('stops the timer when the last client leaves', async () => {
    const list = vi.fn(async () => ROWS);
    const hub = createStatusHub(root, { pollMs: 1000, debounceMs: 30, list });
    const off = hub.subscribe(
      () => {},
      () => {},
    );
    hub.scheduleItems();
    off();
    await wait(80);
    expect(list).not.toHaveBeenCalled();
  });
});
