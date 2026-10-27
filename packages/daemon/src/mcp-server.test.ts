import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { parse, render, type InboxFile } from '@passback/inbox';
import { FakeClock } from './core/fake-clock';
import { createPassbackServer, type CreatePassbackServerOptions } from './mcp-server';

const MARK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function makeFile(overrides: Partial<InboxFile> & { id: string }): InboxFile {
  return {
    schemaVersion: 1,
    batchId: overrides.id,
    category: 'visual',
    status: 'new',
    iteration: 1,
    route: '/products/:id',
    selector: '[data-testid=price]',
    file: 'src/Price.tsx:12:3',
    buildId: '3f2a9c1',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [],
    ...overrides,
  };
}

describe('createPassbackServer', () => {
  let root: string;
  let inboxDir: string;
  let outboxDir: string;
  let client: Client;

  async function connect(opts: Partial<CreatePassbackServerOptions> = {}): Promise<Client> {
    const server = createPassbackServer({ root, ...opts });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([c.connect(clientTransport), server.connect(serverTransport)]);
    return c;
  }

  async function writeMark(file: InboxFile): Promise<void> {
    await mkdir(inboxDir, { recursive: true });
    await writeFile(path.join(inboxDir, `${file.id}.md`), render(file));
  }

  async function readMark(id: string): Promise<InboxFile> {
    return parse(await readFile(path.join(inboxDir, `${id}.md`), 'utf8'));
  }

  async function outboxEntries(): Promise<string[]> {
    try {
      return await readdir(outboxDir);
    } catch {
      return [];
    }
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-mcp-'));
    inboxDir = path.join(root, '.passback', 'inbox');
    outboxDir = path.join(root, '.passback', 'outbox');
    client = await connect();
  });

  afterEach(async () => {
    await client.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('lists the three passback tools', async () => {
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      'passback_open',
      'passback_status',
      'passback_wait',
    ]);
  });

  it('passback_wait returns comments and deprecated marks in both response forms', async () => {
    await writeMark(makeFile({ id: '01A' }));

    const result = await client.callTool({ name: 'passback_wait', arguments: { timeoutSec: 5 } });

    expect(result.isError).toBeFalsy();
    const views = [
      {
        id: '01A',
        comment: 'looks off',
        route: '/products/:id',
        selector: '[data-testid=price]',
        file: 'src/Price.tsx:12:3',
        buildId: '3f2a9c1',
        inboxFile: path.join(inboxDir, '01A.md'),
      },
    ];
    expect(result.structuredContent).toEqual({ comments: views, marks: views });
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ comments: views, marks: views }) },
    ]);
    expect((await readMark('01A')).status).toBe('ack');
  });

  it('passback_wait returns an empty list at the timeout', async () => {
    const result = await client.callTool({ name: 'passback_wait', arguments: { timeoutSec: 1 } });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ comments: [], marks: [] });
  });

  it('passback_wait times out on the injected clock', async () => {
    const clock = new FakeClock(Date.parse('2026-09-27T10:00:00.000Z'));
    const injected = await connect({ clock });

    const pending = injected.callTool({ name: 'passback_wait', arguments: { timeoutSec: 5 } });
    await vi.waitFor(() => expect(clock.pending()).toBeGreaterThan(0));
    clock.advance(5000);
    const result = await pending;

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ comments: [], marks: [] });
    await injected.close();
  });

  it('passback_wait resolves a hashed chain through the manifest of the mark build id', async () => {
    await mkdir(path.join(root, '.passback'), { recursive: true });
    await writeFile(
      path.join(root, '.passback', 'manifest.json'),
      JSON.stringify({ '3f2a9c1': { a0e2acc8: 'src/Price.tsx:12:3' } }),
    );
    await writeMark(makeFile({ id: '01B', file: undefined, buildId: '3f2a9c1' }));
    await mkdir(path.join(inboxDir, '01B'), { recursive: true });
    await writeFile(
      path.join(inboxDir, '01B', 'payload.json'),
      JSON.stringify({ code: { chain: [{ name: 'Price', hash: 'a0e2acc8' }] } }),
    );

    const result = await client.callTool({ name: 'passback_wait', arguments: { timeoutSec: 5 } });

    expect(result.isError).toBeFalsy();
    const marks = (result.structuredContent as { marks: Array<{ file?: string }> }).marks;
    expect(marks[0]?.file).toBe('src/Price.tsx:12:3');
  });

  it('passback_wait leaves file out when no manifest exists', async () => {
    await writeMark(makeFile({ id: '01B', file: undefined, buildId: '3f2a9c1' }));
    await mkdir(path.join(inboxDir, '01B'), { recursive: true });
    await writeFile(
      path.join(inboxDir, '01B', 'payload.json'),
      JSON.stringify({ code: { chain: [{ name: 'Price', hash: 'a0e2acc8' }] } }),
    );

    const result = await client.callTool({ name: 'passback_wait', arguments: { timeoutSec: 5 } });

    expect(result.isError).toBeFalsy();
    const marks = (result.structuredContent as { marks: Array<{ file?: string }> }).marks;
    expect(marks[0]?.file).toBeUndefined();
  });

  it('passback_status writes an outbox event', async () => {
    const result = await client.callTool({
      name: 'passback_status',
      arguments: { markId: MARK_ID, state: 'running' },
    });

    expect(result.isError).toBeFalsy();
    const entries = await outboxEntries();
    expect(entries).toHaveLength(1);
    expect((result.structuredContent as { written: string }).written).toBe(
      path.join(outboxDir, entries[0]!),
    );
    expect((result.structuredContent as { proposed: boolean }).proposed).toBe(false);
  });

  it('passback_status done moves the mark to proposed', async () => {
    await writeMark(makeFile({ id: MARK_ID, status: 'ack', iterations: [] }));

    const result = await client.callTool({
      name: 'passback_status',
      arguments: { markId: MARK_ID, state: 'done', message: 'fixed it' },
    });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { proposed: boolean }).proposed).toBe(true);
    const mark = await readMark(MARK_ID);
    expect(mark.status).toBe('proposed');
    expect(mark.iterations[0]?.agent?.text).toBe('fixed it');
    expect(await outboxEntries()).toHaveLength(1);
  });

  it('passback_status done stamps the reply and the outbox event with the injected clock', async () => {
    const clock = new FakeClock(Date.parse('2026-09-27T10:00:00.000Z'));
    const injected = await connect({ clock });
    await writeMark(makeFile({ id: MARK_ID, status: 'ack', iterations: [] }));

    const result = await injected.callTool({
      name: 'passback_status',
      arguments: { markId: MARK_ID, state: 'done', message: 'fixed it' },
    });

    expect(result.isError).toBeFalsy();
    const mark = await readMark(MARK_ID);
    expect(mark.iterations[0]?.agent?.at).toBe('2026-09-27T10:00:00.000Z');
    const entries = await outboxEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('2026-09-27T10-00-00-000Z');
    await injected.close();
  });

  it('passback_status rejects an unknown state as a tool error', async () => {
    const result = await client.callTool({
      name: 'passback_status',
      arguments: { markId: MARK_ID, state: 'bogus' },
    });

    expect(result.isError).toBe(true);
    expect(String((result.content as Array<{ text: string }>)[0]?.text)).toContain('state');
    expect(await outboxEntries()).toEqual([]);
  });

  it('passback_open refuses a non-http url as a tool error', async () => {
    const open = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    const injected = await connect({ open });

    const result = await injected.callTool({
      name: 'passback_open',
      arguments: { url: 'file:///etc/passwd' },
    });

    expect(result.isError).toBe(true);
    expect(String((result.content as Array<{ text: string }>)[0]?.text)).toContain(
      'passback_open needs an http(s) URL',
    );
    expect(open).not.toHaveBeenCalled();
    await injected.close();
  });
});
