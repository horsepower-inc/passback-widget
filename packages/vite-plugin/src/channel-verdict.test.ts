// "Inbox list, items and verdict". attachChannel applies a passback:verdict
// to the mark's inbox file and answers with passback:items.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    acceptVerdict: (...args: Parameters<typeof actual.acceptVerdict>) =>
      failing.on ? Promise.reject(new Error('boom')) : actual.acceptVerdict(...args),
  };
});

const MARK_ID = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const WITHDRAWN_ID = '01J8Z3K4M5N6P7Q8R9S0T1V2W4';

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

function proposed(id = MARK_ID, status: InboxFile['status'] = 'proposed'): InboxFile {
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

describe('attachChannel: passback:verdict', () => {
  let root: string;
  let inboxDir: string;
  let inboxFile: string;
  let stops: Array<() => void>;
  let logs: string[];

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'passback-channel-verdict-'));
    inboxDir = path.join(root, '.passback', 'inbox');
    mkdirSync(inboxDir, { recursive: true });
    inboxFile = path.join(inboxDir, `${MARK_ID}.md`);
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

  const verdict = (v: string, markId = MARK_ID) => ({ v: 1, markId, verdict: v });
  const itemsOnly = (sent: Sent[]) => sent.filter((s) => s.event === 'passback:items');

  it('applies an accept verdict to a proposed mark and broadcasts a fresh passback:items', async () => {
    const fake = attach();
    expect(fake.emit('passback:verdict', verdict('accept'))).toEqual([]);

    await vi.waitFor(() => expect(itemsOnly(fake.broadcast)).toHaveLength(1), { timeout: 2000 });
    expect(parse(readFileSync(inboxFile, 'utf8')).status).toBe('accepted');
    expect(fake.broadcast[0]).toEqual({
      event: 'passback:items',
      payload: expect.objectContaining({
        v: 1,
        items: [expect.objectContaining({ id: MARK_ID, status: 'accepted' })],
      }),
    });
    expect(logs).toEqual([]);
  });

  it('applies withdraw, park and unpark to the inbox file', async () => {
    const fake = attach();
    const read = () => parse(readFileSync(inboxFile, 'utf8'));

    fake.emit('passback:verdict', verdict('park'));
    await vi.waitFor(() => expect(read().parked).toBe(true), { timeout: 2000 });
    fake.emit('passback:verdict', verdict('unpark'));
    await vi.waitFor(() => expect(read().parked).toBeUndefined(), { timeout: 2000 });
    fake.emit('passback:verdict', verdict('withdraw'));
    await vi.waitFor(() => expect(read().status).toBe('withdrawn'), { timeout: 2000 });
    expect(logs).toEqual([]);
  });

  it('answers a refused verdict with the current snapshot to the asking client only and leaves the file unchanged', async () => {
    writeFileSync(
      path.join(inboxDir, `${WITHDRAWN_ID}.md`),
      render(proposed(WITHDRAWN_ID, 'withdrawn')),
    );
    const fake = attach();
    const before = readFileSync(path.join(inboxDir, `${WITHDRAWN_ID}.md`), 'utf8');

    const replies = fake.emit('passback:verdict', verdict('park', WITHDRAWN_ID));
    const missing = fake.emit('passback:verdict', verdict('accept', '01J8Z3K4M5N6P7Q8R9S0T1V2W5'));
    await vi.waitFor(() => expect(logs).toHaveLength(2), { timeout: 2000 });
    expect([...logs].sort()).toEqual([
      'channel: verdict refused (illegal)',
      'channel: verdict refused (missing)',
    ]);
    // replies are collected per emit call; wait for the async send to land.
    await vi.waitFor(() => expect(replies).toHaveLength(1), { timeout: 2000 });
    await vi.waitFor(() => expect(missing).toHaveLength(1), { timeout: 2000 });
    for (const reply of [...replies, ...missing]) {
      expect(reply).toEqual({
        event: 'passback:items',
        payload: expect.objectContaining({
          v: 1,
          items: expect.arrayContaining([expect.objectContaining({ id: MARK_ID })]),
        }),
      });
    }
    await new Promise((r) => setTimeout(r, 300));
    expect(fake.broadcast).toEqual([]);
    expect(readFileSync(path.join(inboxDir, `${WITHDRAWN_ID}.md`), 'utf8')).toBe(before);
    expect(readdirSync(inboxDir).sort()).toEqual([`${MARK_ID}.md`, `${WITHDRAWN_ID}.md`]);
  });

  it('logs and sends nothing for a verdict that does not parse', async () => {
    const fake = attach();
    const before = readFileSync(inboxFile, 'utf8');
    const replies = fake.emit('passback:verdict', { v: 1, markId: MARK_ID, verdict: 'delete' });

    await vi.waitFor(() => expect(logs).toEqual(['channel: verdict refused (invalid)']), {
      timeout: 2000,
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(replies).toEqual([]);
    expect(fake.broadcast).toEqual([]);
    expect(readFileSync(inboxFile, 'utf8')).toBe(before);
  });

  it('a repeat of an applied verdict changes nothing and pushes one snapshot', async () => {
    const fake = attach();
    fake.emit('passback:verdict', verdict('park'));
    await vi.waitFor(() => expect(itemsOnly(fake.broadcast)).toHaveLength(1), { timeout: 2000 });
    const after = readFileSync(inboxFile, 'utf8');

    const replies = fake.emit('passback:verdict', verdict('park'));
    await vi.waitFor(() => expect(itemsOnly(fake.broadcast)).toHaveLength(2), { timeout: 2000 });
    expect(readFileSync(inboxFile, 'utf8')).toBe(after);
    expect(replies).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('logs a failing verdict and never throws', async () => {
    const fake = attach();
    failing.on = true;
    let replies: Sent[] = [];
    expect(() => {
      replies = fake.emit('passback:verdict', verdict('accept'));
    }).not.toThrow();
    await vi.waitFor(() => expect(logs).toEqual(['channel: verdict handling failed (boom)']), {
      timeout: 2000,
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(replies).toEqual([]);
    expect(fake.broadcast).toEqual([]);
  });
});
