import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { render, type InboxFile } from '@passback/inbox';
import { FakeClock } from './core/fake-clock';
import { createPassbackServer } from './mcp-server';

const START = Date.parse('2026-10-27T10:00:00.000Z');

describe('passback_wait and .passback/agent.json', () => {
  let root: string;
  let clock: FakeClock;
  let client: Client;

  const read = async () =>
    JSON.parse(await readFile(path.join(root, '.passback', 'agent.json'), 'utf8'));

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-mcp-session-'));
    await mkdir(path.join(root, '.passback', 'inbox'), { recursive: true });
    clock = new FakeClock(START);
    const server = createPassbackServer({ root, clock });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'claude-code', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('names the connected agent in agent.json while passback_wait waits', async () => {
    const pending = client.callTool({ name: 'passback_wait', arguments: { timeoutSec: 5 } });
    await vi.waitFor(async () => expect((await read()).waitingSince).not.toBeNull());

    expect(await read()).toMatchObject({
      agent: 'claude-code',
      pid: process.pid,
      waitingSince: new Date(START).toISOString(),
    });

    clock.advance(5000);
    await pending;
  });

  it('marks the agent as working when passback_wait returns comments, times out or is cancelled', async () => {
    const waiting = async () => {
      await vi.waitFor(async () => expect((await read()).waitingSince).not.toBeNull());
    };
    const working = async () => {
      await vi.waitFor(async () => expect((await read()).waitingSince).toBeNull());
    };

    // timeout
    let pending = client.callTool({ name: 'passback_wait', arguments: { timeoutSec: 5 } });
    await waiting();
    clock.advance(5000);
    await pending;
    await working();

    // comments
    pending = client.callTool({ name: 'passback_wait', arguments: { timeoutSec: 5 } });
    await waiting();
    const mark: InboxFile = {
      schemaVersion: 1,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      batchId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      category: 'visual',
      status: 'new',
      iteration: 1,
      route: '/',
      selector: '[data-testid=price]',
      file: 'src/Price.tsx:12:3',
      buildId: '3f2a9c1',
      createdAt: '2026-10-27T10:00:00Z',
      comment: 'looks off',
      annotations: [],
      iterations: [],
    };
    await writeFile(path.join(root, '.passback', 'inbox', `${mark.id}.md`), render(mark));
    clock.advance(1000);
    const result = await pending;
    expect(JSON.stringify(result.structuredContent)).toContain(mark.id);
    await working();

    // cancellation
    const controller = new AbortController();
    const cancelled = client
      .callTool({ name: 'passback_wait', arguments: { timeoutSec: 5 } }, undefined, {
        signal: controller.signal,
      })
      .catch(() => undefined);
    await waiting();
    controller.abort();
    await cancelled;
    await working();
  });
});
