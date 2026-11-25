// over a real Vite dev server and a real websocket: no fake ChannelServer.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePayload } from '@passback/schema';
import type { ChannelAck, ChannelStatus } from '@passback/schema';
import { passback } from './plugin';
import { cleanupRoot, tempRoot, writeProject } from './widget-test-utils';

const BATCH_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const MARK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

type Frame = { type: string; event?: string; data?: unknown };

function batchOf(count: number) {
  const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
  const file = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()[0]!;
  const payload = parsePayload(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
  return {
    schemaVersion: 1,
    id: BATCH_ID,
    createdAt: '2026-09-19T14:00:00.000Z',
    marks: Array.from({ length: count }, () => payload),
  };
}

let server: ViteDevServer | undefined;
let root: string | undefined;
let socket: WebSocket | undefined;
let frames: Frame[] = [];
let acks: ChannelAck[] = [];

afterEach(async () => {
  socket?.close();
  socket = undefined;
  await server?.close();
  server = undefined;
  if (root) cleanupRoot(root);
  root = undefined;
});

function waitFor(predicate: (frame: Frame) => boolean, what: string, ms = 10000): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const existing = frames.find(predicate);
    if (existing) return resolve(existing);
    const ws = socket!;
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(
        new Error(`timed out waiting for ${what}; frames received: ${JSON.stringify(frames)}`),
      );
    }, ms);
    function onMessage(): void {
      const hit = frames.find(predicate);
      if (!hit) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      resolve(hit);
    }
    ws.addEventListener('message', onMessage);
  });
}

async function connect(): Promise<string> {
  root = tempRoot();
  writeProject(root);
  server = await createServer({
    root,
    plugins: [passback()],
    server: { host: '127.0.0.1' },
    optimizeDeps: { noDiscovery: true },
    logLevel: 'silent',
  });
  await server.listen();
  const { port } = server.httpServer?.address() as AddressInfo;
  frames = [];
  acks = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`, 'vite-hmr');
  socket = ws;
  ws.addEventListener('message', (e) => {
    const frame = JSON.parse(String(e.data)) as Frame;
    frames.push(frame);
    if (frame.type === 'custom' && frame.event === 'passback:ack')
      acks.push(frame.data as ChannelAck);
  });
  await waitFor((f) => f.type === 'connected', 'the connected frame');
  return root;
}

function sendMark(data: unknown): void {
  socket!.send(JSON.stringify({ type: 'custom', event: 'passback:mark', data }));
}

async function nextAck(): Promise<ChannelAck> {
  const frame = await waitFor((f) => f.event === 'passback:ack', 'a passback:ack frame');
  return frame.data as ChannelAck;
}

function writeOutbox(dir: string, name: string, status: ChannelStatus): string {
  const outbox = path.join(dir, '.passback', 'outbox');
  mkdirSync(outbox, { recursive: true });
  const file = path.join(outbox, name);
  writeFileSync(file, JSON.stringify(status));
  return file;
}

async function until(condition: () => boolean, what: string, ms = 10000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('passback channel over a real Vite websocket', () => {
  it('a passback:mark over the Vite socket writes the inbox file and acks its id', async () => {
    const dir = await connect();
    sendMark({ v: 1, batch: batchOf(1) });
    const frame = await waitFor((f) => f.event === 'passback:ack', 'a passback:ack frame');
    const ack = frame.data as ChannelAck;
    expect(frame.event).toBe('passback:ack');
    expect(ack.error).toBeUndefined();
    expect(ack.accepted).toHaveLength(1);
    expect(existsSync(path.join(dir, '.passback', 'inbox', `${ack.accepted[0]}.md`))).toBe(true);
  }, 20000);

  it('a status file in .passback/outbox reaches the socket as passback:status and is removed', async () => {
    const dir = await connect();
    const status: ChannelStatus = {
      v: 1,
      markId: MARK_ID,
      state: 'done',
      at: new Date().toISOString(),
    };
    const file = writeOutbox(dir, 'status-1.json', status);
    const frame = await waitFor((f) => f.event === 'passback:status', 'a passback:status frame');
    expect(frame.data).toEqual(status);
    await until(() => !existsSync(file), 'the outbox file to be removed');
    expect(existsSync(file)).toBe(false);
  }, 20000);

  it('a malformed passback:mark is acked with an error and empty accepted', async () => {
    await connect();
    sendMark({ v: 1 });
    const ack = await nextAck();
    expect(ack.error).toBeDefined();
    expect(ack.accepted).toEqual([]);
  }, 20000);

  it('a status file with a +02:00 offset is moved aside and never reaches the socket', async () => {
    const dir = await connect();
    const file = writeOutbox(dir, 'offset.json', {
      v: 1,
      markId: MARK_ID,
      state: 'done',
      at: '2026-09-29T12:00:00+02:00',
    });
    await until(() => existsSync(`${file}.bad`), 'the .bad file');
    await new Promise((r) => setTimeout(r, 1000));
    expect(frames.filter((f) => f.event === 'passback:status')).toEqual([]);
    expect(existsSync(`${file}.bad`)).toBe(true);
  }, 20000);

  it('every ack keeps trimmed within accepted and an empty accepted on error', async () => {
    await connect();
    sendMark({ v: 1, batch: batchOf(1) });
    await until(() => acks.length >= 1, 'the first ack');
    sendMark({ v: 1 });
    await until(() => acks.length >= 2, 'a second ack');
    sendMark({ v: 1, batch: batchOf(1) });
    await until(() => acks.length >= 3, 'a third ack');
    expect(acks).toHaveLength(3);
    for (const ack of acks) {
      for (const id of ack.trimmed) expect(ack.accepted).toContain(id);
      if (ack.error) expect(ack.accepted).toEqual([]);
    }
  }, 20000);
});
