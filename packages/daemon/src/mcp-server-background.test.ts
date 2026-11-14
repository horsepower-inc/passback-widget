import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FakeClock } from './core/fake-clock';
import { createPassbackServer } from './mcp-server';

const START = Date.parse('2026-10-27T10:00:00.000Z');

describe('passback_wait background input and .passback/agent.json', () => {
  let root: string;
  let clock: FakeClock;
  let client: Client;

  const read = async () =>
    JSON.parse(await readFile(path.join(root, '.passback', 'agent.json'), 'utf8'));

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-mcp-bg-'));
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

  it('records background true in agent.json for passback_wait with background true', async () => {
    const pending = client.callTool({
      name: 'passback_wait',
      arguments: { timeoutSec: 5, background: true },
    });
    await vi.waitFor(async () => expect((await read()).waitingSince).not.toBeNull());

    expect(await read()).toMatchObject({ agent: 'claude-code', background: true });

    clock.advance(5000);
    await pending;
  });

  it('records no background key for passback_wait without it', async () => {
    const pending = client.callTool({ name: 'passback_wait', arguments: { timeoutSec: 5 } });
    await vi.waitFor(async () => expect((await read()).waitingSince).not.toBeNull());

    expect(await read()).not.toHaveProperty('background');

    clock.advance(5000);
    await pending;
  });
});
