// attachChannel applies a passback:answer through
// acceptAnswer: the answer file for the waiting agent and a queued running status.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type InboxFile } from '../../inbox/src/index';
import { attachChannel } from './channel';
import type { ChannelClient, ChannelServer } from './channel';

const failing = vi.hoisted(() => ({ on: false }));

vi.mock('@passback/adapters/local', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@passback/adapters/local')>();
  return {
    ...actual,
    acceptAnswer: (...args: Parameters<typeof actual.acceptAnswer>) =>
      failing.on ? Promise.reject(new Error('boom')) : actual.acceptAnswer(...args),
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

function acked(): InboxFile {
  return {
    id: MARK_ID,
    schemaVersion: 1,
    batchId: MARK_ID,
    category: 'visual',
    status: 'ack',
    iteration: 1,
    route: '/products/:id',
    selector: '[data-testid=price]',
    buildId: '3f2a9c1',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [],
  };
}

describe('attachChannel: passback:answer', () => {
  let root: string;
  let answersDir: string;
  let outboxDir: string;
  let stops: Array<() => void>;
  let logs: string[];

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'passback-channel-answer-'));
    mkdirSync(path.join(root, '.passback', 'inbox'), { recursive: true });
    writeFileSync(path.join(root, '.passback', 'inbox', `${MARK_ID}.md`), render(acked()));
    answersDir = path.join(root, '.passback', 'answers');
    outboxDir = path.join(root, '.passback', 'outbox');
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

  const answer = { v: 1, markId: MARK_ID, text: 'the blue one' };

  it('writes the answer file and queues a running status for a posted answer', async () => {
    const fake = attach();
    expect(fake.emit('passback:answer', answer)).toEqual([]);

    await vi.waitFor(() => expect(readdirSync(answersDir)).toEqual([`${MARK_ID}.json`]), {
      timeout: 2000,
    });
    const stored = JSON.parse(readFileSync(path.join(answersDir, `${MARK_ID}.json`), 'utf8'));
    expect(stored).toEqual({
      v: 1,
      markId: MARK_ID,
      text: 'the blue one',
      at: expect.any(String),
    });
    await vi.waitFor(() => expect(fake.broadcast).toHaveLength(1), { timeout: 2000 });
    expect(logs).toEqual([]);
  });

  it('drops an answer for a mark without an inbox file', async () => {
    const fake = attach();
    const missing = { ...answer, markId: '01J8Z3K4M5N6P7Q8R9S0T1V2W4' };

    expect(fake.emit('passback:answer', missing)).toEqual([]);
    expect(fake.emit('passback:answer', { v: 1, markId: MARK_ID })).toEqual([]);
    await vi.waitFor(() => expect(logs).toHaveLength(2), { timeout: 2000 });
    expect(logs).toEqual(['channel: answer not applied', 'channel: answer not applied']);
    expect(readdirSync(path.join(root, '.passback'))).not.toContain('answers');
    expect(readdirSync(outboxDir)).toEqual([]);
    expect(fake.broadcast).toEqual([]);
  });

  it('logs and survives a failing answer writer', async () => {
    const fake = attach();
    failing.on = true;
    expect(() => fake.emit('passback:answer', answer)).not.toThrow();
    await vi.waitFor(() => expect(logs).toEqual(['channel: answer handling failed (boom)']), {
      timeout: 2000,
    });
    expect(fake.broadcast).toEqual([]);
  });

  it('relays the queued running status to every client', async () => {
    const fake = attach();
    fake.emit('passback:answer', answer);

    await vi.waitFor(
      () =>
        expect(fake.broadcast).toEqual([
          {
            event: 'passback:status',
            payload: expect.objectContaining({ v: 1, markId: MARK_ID, state: 'running' }),
          },
        ]),
      { timeout: 2000 },
    );
    await vi.waitFor(() => expect(readdirSync(outboxDir)).toEqual([]), { timeout: 2000 });
  });
});
