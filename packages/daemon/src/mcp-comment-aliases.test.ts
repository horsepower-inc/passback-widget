import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { parse, render, type InboxFile } from '@passback/inbox';
import { createPassbackServer } from './mcp-server';

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

function makeFile(id: string): InboxFile {
  return {
    schemaVersion: 1,
    batchId: id,
    id,
    category: 'visual',
    status: 'ack',
    iteration: 1,
    route: '/',
    selector: '[data-testid=price]',
    buildId: '3f2a9c1',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [],
  };
}

describe('passback_status comment identifiers', () => {
  let root: string;
  let inboxDir: string;
  let outboxDir: string;
  let client: Client;

  async function call(args: Record<string, unknown>): Promise<{
    isError?: boolean;
    text: string;
    structured?: { written: string; proposed: boolean };
  }> {
    const result = await client.callTool({ name: 'passback_status', arguments: args });
    return {
      isError: result.isError as boolean | undefined,
      text: String((result.content as Array<{ text: string }>)[0]?.text),
      structured: result.structuredContent as { written: string; proposed: boolean } | undefined,
    };
  }

  async function events(): Promise<Array<Record<string, unknown>>> {
    let names: string[];
    try {
      names = await readdir(outboxDir);
    } catch {
      return [];
    }
    return Promise.all(
      names.map(async (n) => JSON.parse(await readFile(path.join(outboxDir, n), 'utf8'))),
    );
  }

  async function writeMark(id: string): Promise<void> {
    await mkdir(inboxDir, { recursive: true });
    await writeFile(path.join(inboxDir, `${id}.md`), render(makeFile(id)));
  }

  async function inboxStatus(id: string): Promise<string> {
    return parse(await readFile(path.join(inboxDir, `${id}.md`), 'utf8')).status;
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-mcp-alias-'));
    inboxDir = path.join(root, '.passback', 'inbox');
    outboxDir = path.join(root, '.passback', 'outbox');
    const server = createPassbackServer({ root });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('advertises comment identifiers and deprecated MCP aliases', async () => {
    const { tools } = await client.listTools();
    const status = tools.find((t) => t.name === 'passback_status')!;
    const schema = status.inputSchema as {
      properties: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
    expect(schema.properties.commentId?.type).toBe('string');
    expect(schema.properties.markId?.type).toBe('string');
    expect(schema.required ?? []).not.toContain('commentId');
    expect(schema.required ?? []).not.toContain('markId');
    expect(schema.required ?? []).toContain('state');
    expect(schema.properties.markId?.description).toContain('Deprecated');
    expect(status.description).toContain('commentId');
    const wait = tools.find((t) => t.name === 'passback_wait')!;
    expect(wait.description).toContain('deprecated alias');
  });

  it('commentId writes status and proposes the existing inbox comment', async () => {
    await writeMark(ID);

    const running = await call({ commentId: ID, state: 'running' });
    expect(running.isError).toBeFalsy();
    expect(running.structured?.proposed).toBe(false);

    const done = await call({ commentId: ID, state: 'done', message: 'fixed it' });
    expect(done.isError).toBeFalsy();
    expect(done.structured?.proposed).toBe(true);
    expect(await inboxStatus(ID)).toBe('proposed');

    const written = await events();
    expect(written).toHaveLength(2);
    expect(written.map((e) => e.markId)).toEqual([ID, ID]);
    expect(written.every((e) => !('commentId' in e))).toBe(true);
  });

  it('accepts legacy and equal identifiers with one status event per call', async () => {
    const legacy = await call({ markId: ID, state: 'running' });
    expect(legacy.isError).toBeFalsy();
    expect(await events()).toHaveLength(1);

    const equal = await call({ commentId: ID, markId: ID, state: 'failed', message: 'nope' });
    expect(equal.isError).toBeFalsy();
    const written = await events();
    expect(written).toHaveLength(2);
    expect(written.map((e) => e.markId)).toEqual([ID, ID]);
  });

  it('rejects missing conflicting and invalid identifiers without side effects', async () => {
    await writeMark(ID);
    const before = await readFile(path.join(inboxDir, `${ID}.md`), 'utf8');

    const missing = await call({ state: 'done' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('commentId');

    const conflict = await call({ commentId: ID, markId: OTHER_ID, state: 'done' });
    expect(conflict.isError).toBe(true);
    expect(conflict.text).toContain('commentId');
    expect(conflict.text).toContain('markId');

    const malformed = await call({ commentId: 'not an id!', state: 'done' });
    expect(malformed.isError).toBe(true);
    expect(malformed.text).toContain('commentId');

    const legacyMalformed = await call({ markId: 'not an id!', state: 'done' });
    expect(legacyMalformed.isError).toBe(true);
    expect(legacyMalformed.text).toContain('markId');
    expect(legacyMalformed.text).not.toContain('commentId');

    const nonString = await call({ commentId: 42, state: 'done' });
    expect(nonString.isError).toBe(true);
    expect(nonString.text).toContain('commentId');

    const legacyNonString = await call({ markId: 42, state: 'done' });
    expect(legacyNonString.isError).toBe(true);
    expect(legacyNonString.text).toContain('markId');

    expect(await events()).toEqual([]);
    expect(await readFile(path.join(inboxDir, `${ID}.md`), 'utf8')).toBe(before);
  });

  it('preserves state prUrl and write failure tool errors with commentId', async () => {
    await writeMark(ID);

    const badState = await call({ commentId: ID, state: 'bogus' });
    expect(badState.isError).toBe(true);
    expect(badState.text).toContain('state');

    const badUrl = await call({ commentId: ID, state: 'done', prUrl: 'not a url' });
    expect(badUrl.isError).toBe(true);
    expect(badUrl.text).toContain('prUrl');
    expect(await events()).toEqual([]);
    expect(await inboxStatus(ID)).toBe('ack');

    await writeFile(outboxDir, 'not a directory');
    const failed = await call({ commentId: ID, state: 'done', message: 'fixed it' });
    expect(failed.isError).toBe(true);
    expect(await inboxStatus(ID)).toBe('ack');
  });
});
