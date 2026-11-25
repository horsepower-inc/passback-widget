// attachChannel applies a passback:verified to the named inbox files and
// schedules a fresh passback:items. The message has no reply.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    acceptVerified: (...args: Parameters<typeof actual.acceptVerified>) =>
      failing.on ? Promise.reject(new Error('boom')) : actual.acceptVerified(...args),
  };
});

const MARK_ID = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const ACCEPTED_ID = '01J8Z3K4M5N6P7Q8R9S0T1V2W4';

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

function mark(id = MARK_ID, status: InboxFile['status'] = 'proposed'): InboxFile {
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
    iterations: [{ n: 1, agent: { at: '2026-09-19T14:05:00Z', text: 'fixed the padding' } }],
  };
}

describe('attachChannel: passback:verified', () => {
  let root: string;
  let inboxDir: string;
  let inboxFile: string;
  let stops: Array<() => void>;
  let logs: string[];

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'passback-channel-verified-'));
    inboxDir = path.join(root, '.passback', 'inbox');
    mkdirSync(inboxDir, { recursive: true });
    inboxFile = path.join(inboxDir, `${MARK_ID}.md`);
    writeFileSync(inboxFile, render(mark()));
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

  const itemsOnly = (sent: Sent[]) => sent.filter((s) => s.event === 'passback:items');

  it('moves a proposed mark to verified and broadcasts a fresh passback:items', async () => {
    const fake = attach();
    expect(fake.emit('passback:verified', { v: 1, markIds: [MARK_ID] })).toEqual([]);

    await vi.waitFor(() => expect(itemsOnly(fake.broadcast)).toHaveLength(1), { timeout: 2000 });
    expect(parse(readFileSync(inboxFile, 'utf8')).status).toBe('verified');
    expect(fake.broadcast[0]).toEqual({
      event: 'passback:items',
      payload: expect.objectContaining({
        v: 1,
        items: [expect.objectContaining({ id: MARK_ID, status: 'verified' })],
      }),
    });
    expect(logs).toEqual([]);
  });

  it('leaves a mark that is not proposed alone and still broadcasts', async () => {
    const acceptedFile = path.join(inboxDir, `${ACCEPTED_ID}.md`);
    writeFileSync(acceptedFile, render(mark(ACCEPTED_ID, 'accepted')));
    const before = readFileSync(acceptedFile, 'utf8');
    const fake = attach();

    expect(fake.emit('passback:verified', { v: 1, markIds: [ACCEPTED_ID] })).toEqual([]);

    await vi.waitFor(() => expect(itemsOnly(fake.broadcast)).toHaveLength(1), { timeout: 2000 });
    expect(readFileSync(acceptedFile, 'utf8')).toBe(before);
    expect(parse(readFileSync(inboxFile, 'utf8')).status).toBe('proposed');
    expect(logs).toEqual([]);
  });

  it('ignores an invalid payload without throwing', async () => {
    const fake = attach();
    const before = readFileSync(inboxFile, 'utf8');

    let replies: Sent[] = [];
    expect(() => {
      replies = fake.emit('passback:verified', { v: 1, markIds: 'nope' });
    }).not.toThrow();

    await vi.waitFor(() => expect(itemsOnly(fake.broadcast)).toHaveLength(1), { timeout: 2000 });
    expect(replies).toEqual([]);
    expect(readFileSync(inboxFile, 'utf8')).toBe(before);
  });

  it('logs and survives when acceptVerified rejects', async () => {
    const fake = attach();
    failing.on = true;
    const before = readFileSync(inboxFile, 'utf8');

    let replies: Sent[] = [];
    expect(() => {
      replies = fake.emit('passback:verified', { v: 1, markIds: [MARK_ID] });
    }).not.toThrow();

    await vi.waitFor(() => expect(logs).toEqual(['channel: verified handling failed (boom)']), {
      timeout: 2000,
    });
    await vi.waitFor(() => expect(itemsOnly(fake.broadcast)).toHaveLength(1), { timeout: 2000 });
    expect(replies).toEqual([]);
    expect(readFileSync(inboxFile, 'utf8')).toBe(before);
  });
});
