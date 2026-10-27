// "Inbox list, items and verdict". attachChannel answers passback:list and
// pushes passback:items after every change.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type InboxFile } from '../../inbox/src/index';
import { attachChannel } from './channel';
import type { ChannelClient, ChannelServer } from './channel';

const MARK_ID = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';

type Sent = { event: string; payload: unknown };

function fakeServer() {
  const handlers = new Map<string, (data: unknown, client: ChannelClient) => void>();
  const broadcast: Sent[] = [];
  const server: ChannelServer = {
    ws: {
      on(event, listener) {
        handlers.set(event, listener);
      },
      send(event, payload) {
        broadcast.push({ event, payload });
      },
    },
    httpServer: { once() {} },
  };
  return {
    server,
    broadcast,
    emit(event: string, data: unknown): Sent[] {
      const replies: Sent[] = [];
      handlers.get(event)!(data, {
        send: (e, p) => replies.push({ event: e, payload: p }),
      });
      return replies;
    },
  };
}

function proposed(): InboxFile {
  return {
    id: MARK_ID,
    schemaVersion: 1,
    batchId: MARK_ID,
    category: 'visual',
    status: 'proposed',
    iteration: 1,
    route: '/products/:id',
    selector: '[data-testid=price]',
    buildId: '3f2a9c1',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [{ n: 1, agent: { at: '2026-09-19T14:05:00Z', text: 'fixed the padding' } }],
  };
}

describe('attachChannel: passback:list and passback:items', () => {
  let root: string;
  let stops: Array<() => void>;
  let logs: string[];

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'passback-channel-list-'));
    mkdirSync(path.join(root, '.passback', 'inbox'), { recursive: true });
    writeFileSync(path.join(root, '.passback', 'inbox', `${MARK_ID}.md`), render(proposed()));
    stops = [];
    logs = [];
  });

  afterEach(() => {
    for (const stop of stops) stop();
    rmSync(root, { recursive: true, force: true });
  });

  function attach() {
    const fake = fakeServer();
    stops.push(attachChannel(fake.server, { root, log: (m) => logs.push(m) }));
    return fake;
  }

  const items = (fake: ReturnType<typeof fakeServer>) =>
    fake.broadcast.filter((s) => s.event === 'passback:items');

  it('answers passback:list to the asking client only with the rows and truncated', async () => {
    const fake = attach();
    const replies = fake.emit('passback:list', { v: 1 });
    expect(replies).toEqual([]);
    await vi.waitFor(() => expect(replies).toHaveLength(1), { timeout: 2000 });
    expect(replies[0]).toEqual({
      event: 'passback:items',
      payload: {
        v: 1,
        truncated: false,
        agent: { state: 'absent' },
        items: [expect.objectContaining({ id: MARK_ID, status: 'proposed', iteration: 1 })],
      },
    });
    expect(fake.broadcast).toEqual([]);
  });

  it('ignores a passback:list that does not parse', async () => {
    const fake = attach();
    const replies = fake.emit('passback:list', { v: 2 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(replies).toEqual([]);
    expect(fake.broadcast).toEqual([]);
    expect(logs).toHaveLength(1);
  });

  it('broadcasts passback:items after a mark, a reopen, an orphaned event and a relayed status', async () => {
    const fake = attach();

    fake.emit('passback:mark', { v: 1 });
    await vi.waitFor(() => expect(items(fake)).toHaveLength(1), { timeout: 2000 });

    fake.emit('passback:reopen', { v: 1, markId: MARK_ID, comment: 'still wrong' });
    await vi.waitFor(() => expect(items(fake)).toHaveLength(2), { timeout: 2000 });
    expect(items(fake)[1]!.payload).toEqual(
      expect.objectContaining({
        v: 1,
        items: [expect.objectContaining({ id: MARK_ID, status: 'ack', iteration: 2 })],
      }),
    );

    fake.emit('passback:orphaned', { v: 1, markId: MARK_ID });
    await vi.waitFor(() => expect(items(fake)).toHaveLength(3), { timeout: 2000 });

    // The reopen queued a status in the outbox; its relay is followed by a push too.
    await vi.waitFor(
      () => expect(fake.broadcast.some((s) => s.event === 'passback:status')).toBe(true),
      {
        timeout: 2000,
      },
    );
  });
});
