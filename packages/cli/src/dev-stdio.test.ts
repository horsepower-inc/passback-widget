import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { render } from '@passback/inbox';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const MARK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('passback dev over real stdio', () => {
  let root: string;
  let client: Client;

  beforeAll(() => {
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: packageDir });
  }, 60_000);

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-cli-dev-'));
    await mkdir(path.join(root, '.passback/inbox'), { recursive: true });
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['dist/bin.js', 'dev', '--root', root],
        cwd: packageDir,
        stderr: 'ignore',
      }),
    );
  }, 30_000);

  afterEach(async () => {
    await client.close();
    await rm(root, { recursive: true, force: true });
  });

  it('lists the three passback tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'passback_open',
      'passback_status',
      'passback_wait',
    ]);
  });

  it('passback_wait returns the inbox mark and passback_status done writes the outbox event', async () => {
    await writeFile(
      path.join(root, '.passback/inbox', `${MARK_ID}.md`),
      render({
        schemaVersion: 1,
        id: MARK_ID,
        batchId: MARK_ID,
        category: 'visual',
        status: 'new',
        iteration: 1,
        route: '/products/:id',
        selector: '[data-testid=price]',
        file: 'src/Price.tsx:12:3',
        buildId: '3f2a9c1',
        createdAt: '2026-09-19T14:00:00Z',
        comment: 'align left edge with the title',
        annotations: [],
        iterations: [],
      }),
    );

    const waited = await client.callTool({ name: 'passback_wait', arguments: { timeoutSec: 10 } });
    const { marks } = waited.structuredContent as { marks: Record<string, unknown>[] };
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      id: MARK_ID,
      comment: 'align left edge with the title',
      selector: '[data-testid=price]',
      file: 'src/Price.tsx:12:3',
    });

    const status = await client.callTool({
      name: 'passback_status',
      arguments: { markId: MARK_ID, state: 'done', message: 'aligned' },
    });
    expect(status.structuredContent).toMatchObject({ proposed: true });

    const outbox = path.join(root, '.passback/outbox');
    const files = await readdir(outbox);
    expect(files).toHaveLength(1);
    const event = JSON.parse(await readFile(path.join(outbox, files[0]!), 'utf8'));
    expect(event).toMatchObject({ markId: MARK_ID, state: 'done' });
  });

  it('failure: passback_status with an unknown state is a tool error and writes no outbox event', async () => {
    const result = await client.callTool({
      name: 'passback_status',
      arguments: { markId: MARK_ID, state: 'bogus' },
    });
    expect(result.isError).toBe(true);
    expect(existsSync(path.join(root, '.passback/outbox'))).toBe(false);
  });
});
