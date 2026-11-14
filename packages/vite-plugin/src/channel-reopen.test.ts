// attachChannel applies a passback:reopen to the mark's inbox file.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, render, type InboxFile } from '../../inbox/src/index';
import { attachChannel } from './channel';
import type { ChannelClient, ChannelServer } from './channel';

const failing = vi.hoisted(() => ({ on: false }));

vi.mock('@passback/adapters/local', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@passback/adapters/local')>();
  return {
    ...actual,
    acceptReopen: (...args: Parameters<typeof actual.acceptReopen>) =>
      failing.on ? Promise.reject(new Error('boom')) : actual.acceptReopen(...args),
  };
});

const MARK_ID = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';

type Sent = { event: string; payload: unknown };

function fakeServer(): {
  server: ChannelServer;
  broadcast: Sent[];
  emit(event: string, data: unknown): Sent[];
} {
  const handlers = new Map<string, (data: unknown, client: ChannelClient) => void>();
  const broadcast: Sent[] = [];
  const server: ChannelServer = {
    ws: {
      on(event, listener) {
        handlers.set(event, listener);
      },
      send(event, payload) {
        if (event === 'passback:items') return;
        broadcast.push({ event, payload });
      },
    },
    httpServer: { once() {} },
  };
  return {
    server,
    broadcast,
    emit(event, data) {
      const replies: Sent[] = [];
      const client: ChannelClient = {
        send: (sentEvent, sentPayload) => replies.push({ event: sentEvent, payload: sentPayload }),
      };
      handlers.get(event)!(data, client);
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

describe('attachChannel: passback:reopen', () => {
  let root: string;
  let inboxFile: string;
  let outboxDir: string;
  let stops: Array<() => void>;
  let logs: string[];

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'passback-channel-reopen-'));
    mkdirSync(path.join(root, '.passback', 'inbox'), { recursive: true });
    inboxFile = path.join(root, '.passback', 'inbox', `${MARK_ID}.md`);
    outboxDir = path.join(root, '.passback', 'outbox');
    writeFileSync(inboxFile, render(proposed()));
    stops = [];
    logs = [];
    failing.on = false;
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

  const reopen = { v: 1, markId: MARK_ID, comment: 'still wrong on mobile' };

  it('applies a reopen to a proposed mark: next iteration, status ack, queued status relayed', async () => {
    const fake = attach();
    const replies = fake.emit('passback:reopen', reopen);
    expect(replies).toEqual([]);

    await vi.waitFor(
      () =>
        expect(fake.broadcast).toEqual([
          {
            event: 'passback:status',
            payload: expect.objectContaining({ v: 1, markId: MARK_ID, state: 'queued' }),
          },
        ]),
      { timeout: 2000 },
    );
    const file = parse(readFileSync(inboxFile, 'utf8'));
    expect(file.status).toBe('ack');
    expect(file.iteration).toBe(2);
    expect(file.iterations.find((it) => it.n === 1)?.human?.verdict).toEqual({
      kind: 'comment',
      text: 'still wrong on mobile',
    });
    await vi.waitFor(async () => expect(await readdir(outboxDir)).toEqual([]), { timeout: 2000 });
    expect(logs).toEqual([]);
  });

  it('a repeat of the same reopen only repeats the queued status', async () => {
    const fake = attach();
    fake.emit('passback:reopen', reopen);
    await vi.waitFor(() => expect(fake.broadcast).toHaveLength(1), { timeout: 2000 });
    const after = readFileSync(inboxFile, 'utf8');

    fake.emit('passback:reopen', reopen);
    await vi.waitFor(() => expect(fake.broadcast).toHaveLength(2), { timeout: 2000 });
    expect(fake.broadcast[1]).toEqual({
      event: 'passback:status',
      payload: expect.objectContaining({ markId: MARK_ID, state: 'queued' }),
    });
    expect(readFileSync(inboxFile, 'utf8')).toBe(after);
    expect(logs).toEqual([]);
  });

  it('failure: a reopen the inbox cannot apply changes nothing and sends no status', async () => {
    const fake = attach();
    const before = readFileSync(inboxFile, 'utf8');
    const missing = { ...reopen, markId: '01J8Z3K4M5N6P7Q8R9S0T1V2W4' };

    expect(fake.emit('passback:reopen', missing)).toEqual([]);
    expect(fake.emit('passback:reopen', { v: 1, markId: MARK_ID })).toEqual([]);
    await vi.waitFor(() => expect(logs).toHaveLength(2), { timeout: 2000 });
    expect(logs).toEqual(['channel: reopen not applied', 'channel: reopen not applied']);
    expect(readFileSync(inboxFile, 'utf8')).toBe(before);
    expect(readdirSync(path.join(root, '.passback', 'inbox'))).toEqual([`${MARK_ID}.md`]);
    expect(readdirSync(outboxDir)).toEqual([]);
    expect(fake.broadcast).toEqual([]);
  });

  it('a failing reopen is logged and never thrown', async () => {
    const fake = attach();
    failing.on = true;
    expect(() => fake.emit('passback:reopen', reopen)).not.toThrow();
    await vi.waitFor(() => expect(logs).toEqual(['channel: reopen handling failed (boom)']), {
      timeout: 2000,
    });
    expect(fake.broadcast).toEqual([]);
  });
});
