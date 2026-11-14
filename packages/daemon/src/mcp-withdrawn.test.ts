import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { render, type InboxFile } from '@passback/inbox';
import { createPassbackServer } from './mcp-server';

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function makeFile(overrides: Partial<InboxFile> = {}): InboxFile {
  return {
    schemaVersion: 1,
    batchId: ID,
    id: ID,
    category: 'visual',
    status: 'new',
    iteration: 1,
    route: '/',
    selector: '[data-testid=price]',
    buildId: '3f2a9c1',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [],
    ...overrides,
  };
}

type WaitBody = { comments: Array<{ id: string }>; marks: unknown; withdrawn?: string[] };

describe('passback_wait parked and withdrawn comments', () => {
  let root: string;
  let inboxDir: string;
  let client: Client;

  async function wait(timeoutSec = 1): Promise<WaitBody> {
    const result = await client.callTool({
      name: 'passback_wait',
      arguments: { timeoutSec },
    });
    return result.structuredContent as WaitBody;
  }

  async function write(file: InboxFile): Promise<void> {
    await writeFile(path.join(inboxDir, `${file.id}.md`), render(file));
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-mcp-withdrawn-'));
    inboxDir = path.join(root, '.passback', 'inbox');
    await mkdir(inboxDir, { recursive: true });
    const server = createPassbackServer({ root });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  });

  afterEach(async () => {
    await client.close();
    await rm(root, { recursive: true, force: true });
  });

  it('passback_wait skips a parked comment until it is unparked', async () => {
    await write(makeFile({ parked: true }));
    expect((await wait()).comments).toEqual([]);
    await write(makeFile({ parked: undefined }));
    const body = await wait();
    expect(body.comments.map((c) => c.id)).toEqual([ID]);
  });

  it('passback_wait lists a comment withdrawn after pickup and returns at once', async () => {
    await write(makeFile());
    expect((await wait()).comments.map((c) => c.id)).toEqual([ID]);
    await write(makeFile({ status: 'withdrawn' }));
    const started = Date.now();
    const body = await wait(30);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(body.withdrawn).toEqual([ID]);
    expect(body.comments).toEqual([]);
    const again = await wait();
    expect(again.withdrawn).toBeUndefined();
  });

  it('passback_wait leaves withdrawn out of the body when nothing was withdrawn', async () => {
    await write(makeFile());
    const body = await wait();
    expect(Object.keys(body).sort()).toEqual(['comments', 'marks']);
    const empty = await wait();
    expect(empty).toEqual({ comments: [], marks: [] });
  });
});
