// attachChannel: the HMR channel wired into a (fake) Vite dev server.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePayload } from '@passback/schema';
import type { Batch, ChannelAck, ChannelStatus, Payload } from '@passback/schema';
import { attachChannel } from './channel';
import type { ChannelClient, ChannelServer } from './channel';

const BATCH_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const BATCH_CREATED_AT = '2026-09-19T14:00:00.000Z';
const MARK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function firstPayload(): Payload {
  const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
  const file = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()[0]!;
  return parsePayload(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
}

const payload = firstPayload();

function batchOf(count: number): Batch {
  return {
    schemaVersion: 1,
    id: BATCH_ID,
    createdAt: BATCH_CREATED_AT,
    marks: Array.from({ length: count }, () => payload),
  };
}

function statusEvent(overrides: Partial<ChannelStatus> = {}): ChannelStatus {
  return { v: 1, markId: MARK_ID, state: 'done', at: '2026-09-19T14:00:00.000Z', ...overrides };
}

type Sent = { event: string; payload: unknown };

function fakeServer(): {
  server: ChannelServer;
  broadcast: Sent[];
  emitMark(data: unknown): Promise<Sent>;
  emit(event: string, data: unknown): Sent[];
  close(): void;
} {
  const handlers = new Map<string, (data: unknown, client: ChannelClient) => void>();
  const broadcast: Sent[] = [];
  let closeListener: (() => void) | undefined;

  const server: ChannelServer = {
    ws: {
      on(event, listener) {
        handlers.set(event, listener);
      },
      send(event, payload) {
        broadcast.push({ event, payload });
      },
    },
    httpServer: {
      once(event, listener) {
        if (event === 'close') closeListener = listener;
      },
    },
  };

  return {
    server,
    broadcast,
    emitMark(data: unknown): Promise<Sent> {
      return new Promise((resolve) => {
        const client: ChannelClient = {
          send: (event, sentPayload) => resolve({ event, payload: sentPayload }),
        };
        handlers.get('passback:mark')!(data, client);
      });
    },
    emit(event: string, data: unknown): Sent[] {
      const replies: Sent[] = [];
      const client: ChannelClient = {
        send: (sentEvent, sentPayload) => replies.push({ event: sentEvent, payload: sentPayload }),
      };
      handlers.get(event)!(data, client);
      return replies;
    },
    close(): void {
      closeListener?.();
    },
  };
}

describe('attachChannel', () => {
  let root: string;
  let stops: Array<() => void>;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'passback-channel-'));
    stops = [];
  });

  afterEach(async () => {
    for (const stop of stops) stop();
    await rm(root, { recursive: true, force: true });
  });

  it('writes a valid mark to the inbox and acks only that client', async () => {
    const { server, broadcast, emitMark } = fakeServer();
    const stop = attachChannel(server, { root });
    stops.push(stop);

    const sent = await emitMark({ v: 1, batch: batchOf(1) });
    const ack = sent.payload as ChannelAck;

    expect(sent.event).toBe('passback:ack');
    expect(ack.error).toBeUndefined();
    expect(ack.accepted).toHaveLength(1);

    const inboxFiles = readdirSync(path.join(root, '.passback', 'inbox')).filter((f) =>
      f.endsWith('.md'),
    );
    expect(inboxFiles).toEqual([`${ack.accepted[0]}.md`]);

    expect(broadcast.filter((s) => s.event === 'passback:ack')).toEqual([]);
  });

  it('acks a malformed mark with an error and empty accepted', async () => {
    const { server, emitMark } = fakeServer();
    const stop = attachChannel(server, { root });
    stops.push(stop);

    const sent = await emitMark({
      v: 1,
      batch: { schemaVersion: 1, id: BATCH_ID, createdAt: BATCH_CREATED_AT, marks: [] },
    });
    const ack = sent.payload as ChannelAck;

    expect(ack.error?.code).toBe('bad_request');
    expect(ack.accepted).toEqual([]);
    expect(ack.trimmed).toEqual([]);
  });

  it('keeps trimmed within accepted and accepted empty on error', async () => {
    const { server, emitMark } = fakeServer();
    const stop = attachChannel(server, { root });
    stops.push(stop);

    const okSent = await emitMark({ v: 1, batch: batchOf(3) });
    const okAck = okSent.payload as ChannelAck;
    expect(okAck.error).toBeUndefined();
    expect(okAck.trimmed.every((id) => okAck.accepted.includes(id))).toBe(true);

    // Force a write failure: the inbox root is a plain file, so FileInboxAdapter's mkdir fails.
    const failRoot = mkdtempSync(path.join(os.tmpdir(), 'passback-channel-fail-'));
    mkdirSync(path.join(failRoot, '.passback'));
    writeFileSync(path.join(failRoot, '.passback', 'inbox'), 'not a directory');
    const { server: failServer, emitMark: emitFailMark } = fakeServer();
    const stopFail = attachChannel(failServer, { root: failRoot });
    stops.push(stopFail);

    const failSent = await emitFailMark({ v: 1, batch: batchOf(1) });
    const failAck = failSent.payload as ChannelAck;
    expect(failAck.error?.code).toBe('write_failed');
    expect(failAck.accepted).toEqual([]);
    expect(failAck.trimmed).toEqual([]);
    await rm(failRoot, { recursive: true, force: true });
  });

  it('relays an outbox status file as passback:status unchanged and removes it', async () => {
    const { server, broadcast } = fakeServer();
    const stop = attachChannel(server, { root });
    stops.push(stop);

    const outboxDir = path.join(root, '.passback', 'outbox');
    await mkdir(outboxDir, { recursive: true });
    const event = statusEvent();
    await writeFile(path.join(outboxDir, 'a.json'), JSON.stringify(event));

    await vi.waitFor(
      () => expect(broadcast).toContainEqual({ event: 'passback:status', payload: event }),
      { timeout: 1000 },
    );
    await vi.waitFor(async () => expect(await readdir(outboxDir)).toEqual([]), { timeout: 1000 });
  });

  it('relays a status file that was written before start', async () => {
    const outboxDir = path.join(root, '.passback', 'outbox');
    await mkdir(outboxDir, { recursive: true });
    const event = statusEvent({ state: 'queued' });
    await writeFile(path.join(outboxDir, 'a.json'), JSON.stringify(event));

    const { server, broadcast } = fakeServer();
    const stop = attachChannel(server, { root });
    stops.push(stop);

    await vi.waitFor(
      () => expect(broadcast).toContainEqual({ event: 'passback:status', payload: event }),
      { timeout: 1000 },
    );
  });

  it('passback:orphaned flags the named open mark orphaned in the inbox', async () => {
    const { server, emitMark, emit } = fakeServer();
    stops.push(attachChannel(server, { root }));

    const ack = (await emitMark({ v: 1, batch: batchOf(1) })).payload as ChannelAck;
    const id = ack.accepted[0]!;
    const file = path.join(root, '.passback', 'inbox', `${id}.md`);
    expect(readFileSync(file, 'utf8')).not.toContain('orphaned: true');

    const replies = emit('passback:orphaned', { v: 1, markIds: [id] });
    await vi.waitFor(() => expect(readFileSync(file, 'utf8')).toContain('orphaned: true'), {
      timeout: 1000,
    });
    expect(replies).toEqual([]);
  });

  it('a malformed passback:orphaned message writes nothing and sends no ack', async () => {
    const { server, broadcast, emitMark, emit } = fakeServer();
    stops.push(attachChannel(server, { root }));

    const ack = (await emitMark({ v: 1, batch: batchOf(1) })).payload as ChannelAck;
    const file = path.join(root, '.passback', 'inbox', `${ack.accepted[0]!}.md`);
    const before = readFileSync(file, 'utf8');

    const replies = [
      ...emit('passback:orphaned', { v: 1, markIds: [] }),
      ...emit('passback:orphaned', { v: 1, markIds: ['../x'] }),
      ...emit('passback:orphaned', null),
    ];
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(replies).toEqual([]);
    expect(broadcast.filter((s) => s.event === 'passback:ack')).toEqual([]);
  });

  it('a failing orphan write is logged and never thrown', async () => {
    const adapters = await import('@passback/adapters/local');
    const spy = vi
      .spyOn(adapters, 'acceptOrphaned')
      .mockRejectedValueOnce(new Error('disk full'));
    try {
      const log = vi.fn();
      const { server, emit } = fakeServer();
      stops.push(attachChannel(server, { root, log }));

      expect(() => emit('passback:orphaned', { v: 1, markIds: [MARK_ID] })).not.toThrow();
      await vi.waitFor(
        () => expect(log).toHaveBeenCalledWith('channel: orphaned handling failed (disk full)'),
        { timeout: 1000 },
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('stops the relay when stopped', async () => {
    const { server, broadcast } = fakeServer();
    const stop = attachChannel(server, { root });

    await new Promise((resolve) => setTimeout(resolve, 50));
    stop();
    stop();

    const outboxDir = path.join(root, '.passback', 'outbox');
    await mkdir(outboxDir, { recursive: true });
    await writeFile(path.join(outboxDir, 'a.json'), JSON.stringify(statusEvent()));
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(broadcast.filter((s) => s.event === 'passback:status')).toEqual([]);
  });
});
