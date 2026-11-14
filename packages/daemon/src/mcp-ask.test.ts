import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { render, type InboxFile } from '@passback/inbox';
import { FakeClock } from './core/fake-clock';
import { createPassbackServer } from './mcp-server';

const MARK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ANSWER_AT = '2026-10-29T10:00:00.000Z';

function makeFile(id: string): InboxFile {
  return {
    schemaVersion: 1,
    batchId: id,
    id,
    category: 'visual',
    status: 'ack',
    iteration: 1,
    route: '/products/:id',
    selector: '[data-testid=price]',
    file: 'src/Price.tsx:12:3',
    buildId: '3f2a9c1',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [],
  };
}

describe('passback_ask', () => {
  let root: string;
  let outboxDir: string;
  let answersDir: string;
  let clock: FakeClock;
  let client: Client;

  async function outbox(): Promise<string[]> {
    try {
      return (await readdir(outboxDir)).filter((name) => name.endsWith('.json'));
    } catch {
      return [];
    }
  }

  // One published question, plus the answer timeout and the next answer poll registered.
  async function askReady(): Promise<void> {
    await vi.waitFor(
      async () => {
        expect(await outbox()).toHaveLength(1);
        expect(clock.pending()).toBe(2);
      },
      { timeout: 5000, interval: 10 },
    );
  }

  async function writeAnswer(text: string): Promise<void> {
    await mkdir(answersDir, { recursive: true });
    await writeFile(
      path.join(answersDir, `${MARK_ID}.json`),
      JSON.stringify({ v: 1, markId: MARK_ID, text, at: ANSWER_AT }),
    );
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-ask-'));
    outboxDir = path.join(root, '.passback', 'outbox');
    answersDir = path.join(root, '.passback', 'answers');
    const inboxDir = path.join(root, '.passback', 'inbox');
    await mkdir(inboxDir, { recursive: true });
    await writeFile(path.join(inboxDir, `${MARK_ID}.md`), render(makeFile(MARK_ID)));
    clock = new FakeClock(Date.parse('2026-10-29T09:00:00.000Z'));
    const server = createPassbackServer({ root, clock });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('returns the reporter answer with a temporary file in the outbox', async () => {
    await mkdir(outboxDir, { recursive: true });
    await writeFile(path.join(outboxDir, 'pending.tmp'), '');
    const call = client.callTool({
      name: 'passback_ask',
      arguments: { commentId: MARK_ID, question: ' Which price? ' },
    });
    await askReady();

    const files = await outbox();
    expect(files).toHaveLength(1);
    expect(await readdir(outboxDir)).toContain('pending.tmp');
    const event = JSON.parse(await readFile(path.join(outboxDir, files[0]!), 'utf8')) as {
      state: string;
      message: string;
    };
    expect(event).toMatchObject({ state: 'question', message: 'Which price?' });

    await writeAnswer('The sale price');
    clock.advance(100);
    const result = await call;

    const body = { answer: 'The sale price', answeredAt: ANSWER_AT };
    expect(result.structuredContent).toEqual(body);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(body) }]);
    expect(clock.pending()).toBe(0);
  });

  it('deletes a stale answer after answer polling is ready', async () => {
    await writeAnswer('stale');

    const call = client.callTool({
      name: 'passback_ask',
      arguments: { commentId: MARK_ID, question: 'Which price?', timeoutSec: 5 },
    });
    await askReady();
    await expect(readFile(path.join(answersDir, `${MARK_ID}.json`), 'utf8')).rejects.toThrow();
    clock.advance(5000);
    const result = await call;

    expect(result.structuredContent).toEqual({ timedOut: true });
    expect(clock.pending()).toBe(0);
  });

  it('returns timedOut at the timeout', async () => {
    const call = client.callTool({
      name: 'passback_ask',
      arguments: { commentId: MARK_ID, question: 'Which price?', timeoutSec: 3 },
    });
    await askReady();
    clock.advance(3000);
    const result = await call;

    expect(result.structuredContent).toEqual({ timedOut: true });
    expect(result.content).toEqual([{ type: 'text', text: '{"timedOut":true}' }]);
    expect(clock.pending()).toBe(0);
  });

  it('returns timedOut when the call is aborted', async () => {
    const controller = new AbortController();
    const call = client.callTool(
      { name: 'passback_ask', arguments: { commentId: MARK_ID, question: 'Which price?' } },
      undefined,
      { signal: controller.signal },
    );
    await askReady();
    controller.abort();

    await expect(call).rejects.toBeDefined();
    expect(await outbox()).toHaveLength(1);
  });

  it('refuses an unknown comment id and writes nothing', async () => {
    const unknown = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
    const result = await client.callTool({
      name: 'passback_ask',
      arguments: { commentId: unknown, question: 'Which price?' },
    });
    const malformed = await client.callTool({
      name: 'passback_ask',
      arguments: { commentId: '../x', question: 'Which price?' },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain(unknown);
    expect(malformed.isError).toBe(true);
    expect(JSON.stringify(malformed.content)).toContain('../x');
    expect(await outbox()).toEqual([]);
  });

  it('refuses a blank question', async () => {
    const result = await client.callTool({
      name: 'passback_ask',
      arguments: { commentId: MARK_ID, question: '   ' },
    });

    expect(result.isError).toBe(true);
    expect(await outbox()).toEqual([]);
  });
});
