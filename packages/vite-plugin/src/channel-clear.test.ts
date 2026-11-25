// attachChannel applies a passback:clear to `.passback` and
// answers the asking client with the counts.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    clearInbox: (...args: Parameters<typeof actual.clearInbox>) =>
      failing.on ? Promise.reject(new Error('boom')) : actual.clearInbox(...args),
  };
});

const ACCEPTED_ID = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const NEW_ID = '01J8Z3K4M5N6P7Q8R9S0T1V2W4';

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

function comment(id: string, status: InboxFile['status']): InboxFile {
  return {
    id,
    schemaVersion: 1,
    batchId: id,
    category: 'visual',
    status,
    iteration: 1,
    route: '/products/:id',
    selector: '[data-testid=price]',
    buildId: '3f2a9c1',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [{ n: 1 }],
  };
}

describe('attachChannel: passback:clear', () => {
  let root: string;
  let inbox: string;
  let stops: Array<() => void>;
  let logs: string[];

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'passback-channel-clear-'));
    inbox = path.join(root, '.passback', 'inbox');
    mkdirSync(inbox, { recursive: true });
    writeFileSync(path.join(inbox, `${ACCEPTED_ID}.md`), render(comment(ACCEPTED_ID, 'accepted')));
    writeFileSync(path.join(inbox, `${NEW_ID}.md`), render(comment(NEW_ID, 'new')));
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

  it('answers a clear of the fixed scope to the asking client only with the counts', async () => {
    const fake = attach();
    const replies = fake.emit('passback:clear', { v: 1, scope: 'fixed' });

    await vi.waitFor(() => expect(replies).toHaveLength(1), { timeout: 2000 });
    expect(replies).toEqual([
      {
        event: 'passback:cleared',
        payload: {
          v: 1,
          scope: 'fixed',
          comments: 1,
          attachments: 0,
          answers: 0,
          done: 0,
          settings: false,
        },
      },
    ]);
    expect(fake.broadcast).toEqual([]);
    expect(existsSync(path.join(inbox, `${ACCEPTED_ID}.md`))).toBe(false);
    expect(existsSync(path.join(inbox, `${NEW_ID}.md`))).toBe(true);
    expect(logs).toEqual([]);
  });

  it('answers a workspace clear with settings false and keeps the other files in .passback', async () => {
    const config = path.join(root, '.passback', 'config.json');
    writeFileSync(config, '{}');
    const fake = attach();
    const replies = fake.emit('passback:clear', { v: 1, scope: 'workspace' });

    await vi.waitFor(() => expect(replies).toHaveLength(1), { timeout: 2000 });
    expect(replies[0]).toEqual({
      event: 'passback:cleared',
      payload: expect.objectContaining({
        v: 1,
        scope: 'workspace',
        comments: 2,
        settings: false,
      }),
    });
    expect(fake.broadcast).toEqual([]);
    expect(readdirSync(inbox).filter((n) => n.endsWith('.md'))).toEqual([]);
    expect(existsSync(config)).toBe(true);
    expect(logs).toEqual([]);
  });

  it('logs and sends nothing for a request the schema refuses', async () => {
    const fake = attach();
    const replies = fake.emit('passback:clear', { v: 1, scope: 'fixed', settings: true });

    await vi.waitFor(() => expect(logs).toEqual(['channel: clear not applied (invalid)']), {
      timeout: 2000,
    });
    expect(replies).toEqual([]);
    expect(fake.broadcast).toEqual([]);
    expect(existsSync(path.join(inbox, `${ACCEPTED_ID}.md`))).toBe(true);
    expect(existsSync(path.join(inbox, `${NEW_ID}.md`))).toBe(true);
  });

  it('logs and sends nothing when the adapter rejects', async () => {
    const fake = attach();
    failing.on = true;
    let replies: Sent[] = [];
    expect(() => {
      replies = fake.emit('passback:clear', { v: 1, scope: 'fixed' });
    }).not.toThrow();

    await vi.waitFor(() => expect(logs).toEqual(['channel: clear handling failed (boom)']), {
      timeout: 2000,
    });
    expect(replies).toEqual([]);
    expect(fake.broadcast).toEqual([]);
  });
});
