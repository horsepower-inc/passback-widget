// Local-mode screenshots: the shot chunk route, the upload route and the inbox wrapper.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import { acceptMark, FileInboxAdapter } from '@passback/adapters/local';
import { parsePayload } from '@passback/schema';
import type { Payload } from '@passback/schema';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ensureWidgetBuilt from './global-setup';
import { passback } from './plugin';
import { ShotInboxAdapter } from './shot-inbox';
import { createShotStash, readShotArtifact } from './shot-local';
import { cleanupRoot, tempRoot, writeProject } from './widget-test-utils';

const BATCH_ID = '01J00000000000000000000000';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let server: ViteDevServer | undefined;
const dirs: string[] = [];

beforeAll(() => ensureWidgetBuilt(), 120_000);

afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
  server = undefined;
  for (const dir of dirs.splice(0)) cleanupRoot(dir);
});

async function startServer(): Promise<string> {
  const root = tempRoot();
  dirs.push(root);
  writeProject(root);
  server = await createServer({
    root,
    plugins: [passback({ screenshots: true })],
    server: { port: 0, host: '127.0.0.1' },
    optimizeDeps: { noDiscovery: true },
    logLevel: 'silent',
  });
  await server.listen();
  const address = server.httpServer!.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}

function post(url: string, body: BodyInit, type = 'image/png'): Promise<Response> {
  return fetch(`${url}/@passback/screenshots`, {
    method: 'POST',
    headers: { 'Content-Type': type, Connection: 'close' },
    body,
  });
}

function payloadWith(
  shotId: string | undefined,
  mime: 'image/png' | 'image/webp' = 'image/png',
): Payload {
  const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
  const file = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()[0]!;
  const base = parsePayload(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
  if (shotId === undefined) return base;
  const screenshot = { id: shotId, mime, width: 10, height: 10, bytes: PNG.length, masked: 0 };
  return { ...base, screenshot };
}

function inboxRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'passback-shot-inbox-'));
  dirs.push(dir);
  return dir;
}

describe('local screenshots', () => {
  it('serves the shot chunk at /@passback/shot.js beside the widget', async () => {
    const url = await startServer();
    const response = await fetch(`${url}/@passback/shot.js`, { headers: { Connection: 'close' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    const body = Buffer.from(await response.arrayBuffer());
    expect(body.equals(readShotArtifact().bytes)).toBe(true);
    expect(
      (
        await fetch(`${url}/@passback/shot.js`, {
          method: 'HEAD',
          headers: { Connection: 'close' },
        })
      ).status,
    ).toBe(200);
  }, 20000);

  it('stores a posted png and answers 201 with a 32 hex id', async () => {
    const url = await startServer();
    const response = await post(url, PNG);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(body.id).toMatch(/^[0-9a-f]{32}$/);
    const stash = createShotStash();
    const id = stash.put(PNG);
    expect(stash.take(id)?.equals(PNG)).toBe(true);
    expect(stash.take(id)).toBeUndefined();
    const first = stash.put(PNG);
    for (let i = 0; i < 20; i++) stash.put(PNG);
    expect(stash.take(first)).toBeUndefined();
  }, 20000);

  it('refuses a non-png body with 415 and a body over 2 MiB with 413', async () => {
    const url = await startServer();
    expect((await post(url, PNG, 'image/webp')).status).toBe(415);
    expect((await post(url, PNG, 'image/png; charset=x')).status).toBe(415);
    expect((await post(url, Buffer.alloc(2097153))).status).toBe(413);
    expect((await post(url, Buffer.alloc(2097152))).status).toBe(201);
    expect((await fetch(`${url}/@passback/screenshots`)).headers.get('content-type')).toContain(
      'text/html',
    );
  }, 20000);

  it('writes screenshot.png before the inbox file for a mark that names a stored picture', async () => {
    const root = inboxRoot();
    const stash = createShotStash();
    const id = stash.put(PNG);
    let seen: boolean | undefined;
    let fail = true;
    const real = FileInboxAdapter.prototype.createIssue;
    vi.spyOn(FileInboxAdapter.prototype, 'createIssue').mockImplementation(async function (
      this: FileInboxAdapter,
      ...args
    ) {
      const dirs = readdirSync(root);
      seen = dirs.length === 1 && existsSync(path.join(root, dirs[0]!, 'screenshot.png'));
      if (fail) {
        fail = false;
        throw new Error('disk full');
      }
      return real.apply(this, args);
    });
    const adapter = new ShotInboxAdapter(root, stash);
    // A failed write leaves no trace and keeps the picture, so the retried send still carries it.
    await expect(adapter.createIssue(payloadWith(id))).rejects.toThrow('disk full');
    expect(seen).toBe(true);
    expect(readdirSync(root)).toEqual([]);
    seen = undefined;
    const ref = await adapter.createIssue(payloadWith(id));
    expect(seen).toBe(true);
    expect(readFileSync(path.join(root, ref.id, 'screenshot.png')).equals(PNG)).toBe(true);
    expect(existsSync(path.join(root, `${ref.id}.md`))).toBe(true);
    expect(existsSync(path.join(root, ref.id, 'payload.json'))).toBe(true);
    expect(stash.take(id)).toBeUndefined();

    // A batch of one keeps its own batch id through acceptMark, as with the plain adapter.
    const batch = { schemaVersion: 1, id: BATCH_ID, createdAt: new Date(0).toISOString() };
    const ack = await acceptMark(adapter, {
      v: 1,
      batch: { ...batch, marks: [payloadWith(stash.put(PNG))] },
    });
    expect(ack.error).toBeUndefined();
    const md = readFileSync(path.join(root, `${ack.accepted[0]}.md`), 'utf8');
    expect(md).toContain(BATCH_ID);
    expect(existsSync(path.join(root, ack.accepted[0]!, 'screenshot.png'))).toBe(true);
  });

  it('keeps the picture of a mark whose inbox file was published before the write rejected', async () => {
    const root = inboxRoot();
    const stash = createShotStash();
    const id = stash.put(PNG);
    const real = FileInboxAdapter.prototype.createIssue;
    vi.spyOn(FileInboxAdapter.prototype, 'createIssue').mockImplementation(async function (
      this: FileInboxAdapter,
      ...args
    ) {
      await real.apply(this, args);
      throw new Error('temp file cleanup failed');
    });
    const ref = await new ShotInboxAdapter(root, stash).createIssue(payloadWith(id));
    expect(existsSync(path.join(root, `${ref.id}.md`))).toBe(true);
    expect(readFileSync(path.join(root, ref.id, 'screenshot.png')).equals(PNG)).toBe(true);
    expect(existsSync(path.join(root, ref.id, 'payload.json'))).toBe(true);
    expect(stash.take(id)).toBeUndefined();
  });

  it('files a mark whose picture is unknown without a screenshot.png', async () => {
    const root = inboxRoot();
    const stash = createShotStash();
    const adapter = new ShotInboxAdapter(root, stash);
    const unknown = await adapter.createIssue(payloadWith('a'.repeat(32)));
    expect(existsSync(path.join(root, `${unknown.id}.md`))).toBe(true);
    expect(existsSync(path.join(root, unknown.id, 'screenshot.png'))).toBe(false);

    const id = stash.put(PNG);
    const webp = await adapter.createIssue(payloadWith(id, 'image/webp'));
    expect(existsSync(path.join(root, webp.id, 'screenshot.png'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
