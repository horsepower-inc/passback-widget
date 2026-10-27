// passback:orphaned over a real Vite dev server and a real websocket.

import { readFileSync, readdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parsePayload } from '@passback/schema';
import type { ChannelAck } from '@passback/schema';
import setup from './global-setup';
import { passback } from './plugin';
import { cleanupRoot, tempRoot, writeProject } from './widget-test-utils';

type Frame = { type: string; event?: string; data?: unknown };

let server: ViteDevServer | undefined;
let root: string | undefined;
let socket: WebSocket | undefined;
let frames: Frame[] = [];

beforeAll(() => setup(), 150_000);

afterEach(async () => {
  socket?.close();
  socket = undefined;
  await server?.close();
  server = undefined;
  if (root) cleanupRoot(root);
  root = undefined;
});

async function until(condition: () => boolean, what: string, ms = 10000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function acksOf(): Frame[] {
  return frames.filter((f) => f.type === 'custom' && f.event === 'passback:ack');
}

function emit(event: string, data: unknown): void {
  socket!.send(JSON.stringify({ type: 'custom', event, data }));
}

function oneMarkBatch() {
  const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
  const file = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()[0]!;
  const payload = parsePayload(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
  return {
    schemaVersion: 1,
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    createdAt: '2026-09-19T14:00:00.000Z',
    marks: [payload],
  };
}

// Connects, sends one mark, waits for its ack and returns the inbox file path.
async function ackedMark(): Promise<string> {
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
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`, 'vite-hmr');
  socket = ws;
  ws.addEventListener('message', (e) => frames.push(JSON.parse(String(e.data)) as Frame));
  await until(() => frames.some((f) => f.type === 'connected'), 'the connected frame');
  emit('passback:mark', { v: 1, batch: oneMarkBatch() });
  await until(() => acksOf().length >= 1, 'the passback:ack frame');
  const ack = acksOf()[0]!.data as ChannelAck;
  expect(ack.error).toBeUndefined();
  return path.join(root, '.passback', 'inbox', `${ack.accepted[0]}.md`);
}

describe('passback:orphaned over a real Vite websocket', () => {
  it('flags the acked mark orphaned in its inbox file', async () => {
    const file = await ackedMark();
    const id = path.basename(file, '.md');
    expect(readFileSync(file, 'utf8')).not.toContain('orphaned: true');
    emit('passback:orphaned', { v: 1, markIds: [id] });
    await until(() => readFileSync(file, 'utf8').includes('orphaned: true'), 'orphaned: true');
    expect(readFileSync(file, 'utf8')).toContain('orphaned: true');
  }, 30000);

  it('failure: a malformed message leaves the inbox file unchanged and is not acked', async () => {
    const file = await ackedMark();
    const before = readFileSync(file);
    emit('passback:orphaned', { v: 1, markIds: [] });
    emit('passback:orphaned', { v: 1, markIds: ['../x'] });
    emit('passback:orphaned', null);
    await new Promise((r) => setTimeout(r, 500));
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(acksOf()).toHaveLength(1);
  }, 30000);
});
