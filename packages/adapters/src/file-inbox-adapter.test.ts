import { readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePayload } from '@passback/schema';
import type { Batch, Payload } from '@passback/schema';
import { fromPayload, parse, render } from '@passback/inbox';
import type { MarkStatus } from '@passback/inbox';
import { adapterContract } from './contract';
import type { ContractHarness } from './contract';
import { FileInboxAdapter } from './file-inbox-adapter';
import type { Attachment, Ref, TrackerAdapter, Unsubscribe } from './tracker-adapter';

const BATCH_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const BATCH_CREATED_AT = '2026-09-19T14:00:00.000Z';

function firstPayload(): Payload {
  const dir = fileURLToPath(new URL('../../../fixtures/payloads/', import.meta.url));
  const file = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()[0]!;
  return parsePayload(JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
}

const payload = firstPayload();

async function writeSource(name: string, content: string): Promise<Attachment> {
  const srcDir = await mkdtemp(path.join(os.tmpdir(), 'passback-src-'));
  const filePath = path.join(srcDir, name);
  await writeFile(filePath, content);
  return { name, path: filePath };
}

function twoMarkBatch(target?: { parent: string }): Batch {
  return {
    schemaVersion: 1,
    id: BATCH_ID,
    ...(target ? { target } : {}),
    createdAt: BATCH_CREATED_AT,
    marks: [payload, payload],
  };
}

function makeContractHarness(): ContractHarness {
  let dir = '';
  return {
    async setup() {
      dir = await mkdtemp(path.join(os.tmpdir(), 'passback-adapters-'));
      return new FileInboxAdapter({ root: dir, pollMs: 20 });
    },
    teardown: async () => rm(dir, { recursive: true, force: true }),
    payload,
    async setStatus(ref, status) {
      const filePath = path.join(dir, `${ref.id}.md`);
      const current = parse(await readFile(filePath, 'utf8'));
      await writeFile(filePath, render({ ...current, status: status as MarkStatus }));
    },
    attachment: writeSource,
    settleMs: 200,
    optionalMethods: ['getStatus'],
  };
}

adapterContract('FileInboxAdapter', makeContractHarness());

describe('FileInboxAdapter', () => {
  let dir: string;
  let adapter: FileInboxAdapter;
  let unsubs: Unsubscribe[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-adapters-'));
    adapter = new FileInboxAdapter({ root: dir, pollMs: 20 });
    unsubs = [];
  });

  afterEach(async () => {
    for (const unsubscribe of unsubs) unsubscribe();
    await rm(dir, { recursive: true, force: true });
  });

  function track(ref: Ref): { calls: string[]; unsubscribe: Unsubscribe } {
    const calls: string[] = [];
    const unsubscribe = adapter.onStatusChange(ref, (s) => calls.push(s));
    unsubs.push(unsubscribe);
    return { calls, unsubscribe };
  }

  async function bump(ref: Ref, status: MarkStatus): Promise<void> {
    const filePath = path.join(dir, `${ref.id}.md`);
    const current = parse(await readFile(filePath, 'utf8'));
    await writeFile(filePath, render({ ...current, status }));
  }

  it('getStatus rejects a ref with a path separator', async () => {
    await expect(adapter.getStatus({ id: '../escape' })).rejects.toThrow(
      'invalid ref id: ../escape',
    );
  });

  it('has no comment method because the inbox file format keeps the iterations', () => {
    const asTracker: TrackerAdapter = adapter;
    expect(asTracker.comment).toBeUndefined();
  });

  it('createIssue writes <id>.md that parses to the fromPayload output', async () => {
    const now = new Date('2026-09-19T14:00:00.000Z');
    const local = new FileInboxAdapter({ root: dir, newId: () => 'fixed-id', now: () => now });
    const ref = await local.createIssue(payload);
    expect(ref.id).toBe('fixed-id');
    const text = await readFile(path.join(dir, 'fixed-id.md'), 'utf8');
    expect(parse(text)).toEqual(
      fromPayload(payload, { id: 'fixed-id', batchId: 'fixed-id', createdAt: now.toISOString() }),
    );
  });

  it('createIssue creates a missing root directory', async () => {
    const root = path.join(dir, 'a', 'b');
    const local = new FileInboxAdapter({ root });
    const ref = await local.createIssue(payload);
    await expect(readFile(path.join(root, `${ref.id}.md`), 'utf8')).resolves.toContain(ref.id);
  });

  it('createIssue without a parent uses the mark id as batchId', async () => {
    const ref = await adapter.createIssue(payload);
    const text = await readFile(path.join(dir, `${ref.id}.md`), 'utf8');
    expect(parse(text).batchId).toBe(ref.id);
  });

  it('createIssue with a parent uses the parent id as batchId', async () => {
    const parentRef: Ref = { id: 'parent-id' };
    const ref = await adapter.createIssue(payload, { parent: parentRef });
    const text = await readFile(path.join(dir, `${ref.id}.md`), 'utf8');
    expect(parse(text).batchId).toBe('parent-id');
  });

  it('createIssue rejects an id collision and keeps the first file', async () => {
    const local = new FileInboxAdapter({ root: dir, newId: () => 'dup-id' });
    const first = await local.createIssue(payload);
    const before = await readFile(path.join(dir, 'dup-id.md'), 'utf8');
    const other = { ...payload, intent: { ...payload.intent, comment: 'second' } };
    await expect(local.createIssue(other)).rejects.toThrow();
    expect(await readFile(path.join(dir, 'dup-id.md'), 'utf8')).toBe(before);
    expect(first.id).toBe('dup-id');
  });

  it('concurrent createIssue calls write one parseable file each', async () => {
    const refs = await Promise.all(Array.from({ length: 5 }, () => adapter.createIssue(payload)));
    for (const ref of refs) {
      const text = await readFile(path.join(dir, `${ref.id}.md`), 'utf8');
      expect(() => parse(text)).not.toThrow();
    }
  });

  it('createParent returns the batch id and writes nothing', async () => {
    const before = await readdir(dir);
    const ref = await adapter.createParent(twoMarkBatch());
    expect(ref.id).toBe(BATCH_ID);
    expect(await readdir(dir)).toEqual(before);
  });

  it('createParent ignores target.parent', async () => {
    const ref = await adapter.createParent(twoMarkBatch({ parent: 'TRACKER-1' }));
    expect(ref.id).toBe(BATCH_ID);
  });

  it('attach copies the source into <id>/', async () => {
    const ref = await adapter.createIssue(payload);
    const file = await writeSource('wireframe.svg', '<svg/>');
    await adapter.attach(ref, file);
    expect(await readFile(path.join(dir, ref.id, 'wireframe.svg'), 'utf8')).toBe('<svg/>');
  });

  it('attach rejects a name collision and keeps the first copy', async () => {
    const ref = await adapter.createIssue(payload);
    const file = await writeSource('note.txt', 'first');
    await adapter.attach(ref, file);
    await writeFile(file.path, 'second');
    await expect(adapter.attach(ref, file)).rejects.toThrow();
    expect(await readFile(path.join(dir, ref.id, 'note.txt'), 'utf8')).toBe('first');
  });

  it('attach rejects a missing source file', async () => {
    const ref = await adapter.createIssue(payload);
    const missing = path.join(dir, 'does-not-exist.txt');
    await expect(adapter.attach(ref, { name: 'note.txt', path: missing })).rejects.toThrow();
    await expect(readFile(path.join(dir, ref.id, 'note.txt'), 'utf8')).rejects.toThrow();
  });

  it('attach rejects a name that is not a plain file name', async () => {
    const ref = await adapter.createIssue(payload);
    for (const name of ['', 'a/b', 'a\\b', '.', '..']) {
      await expect(adapter.attach(ref, { name, path: dir })).rejects.toThrow();
    }
  });

  it('attach rejects the parent ref', async () => {
    const parent = await adapter.createParent(twoMarkBatch());
    const file = await writeSource('note.txt', 'hi');
    await expect(adapter.attach(parent, file)).rejects.toThrow();
  });

  it('a ref id with a path separator is rejected', async () => {
    const ref: Ref = { id: '../x' };
    const file = await writeSource('note.txt', 'hi');
    await expect(adapter.attach(ref, file)).rejects.toThrow();
    expect(() => adapter.onStatusChange(ref, () => {})).toThrow();
  });

  it('onStatusChange throws for a ref with no inbox file', () => {
    expect(() => adapter.onStatusChange({ id: 'never-created' }, () => {})).toThrow();
  });

  it('onStatusChange ignores an unparseable mid-write file', async () => {
    const ref = await adapter.createIssue(payload);
    const filePath = path.join(dir, `${ref.id}.md`);
    const original = await readFile(filePath, 'utf8');
    const ackVersion = render({ ...parse(original), status: 'ack' });
    const { calls } = track(ref);
    await writeFile(filePath, original.slice(0, 10));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toEqual([]);
    await writeFile(filePath, ackVersion);
    await vi.waitFor(() => expect(calls).toEqual(['ack']), { timeout: 200 });
  });

  it('onStatusChange ignores a write that keeps the status', async () => {
    const ref = await adapter.createIssue(payload);
    const filePath = path.join(dir, `${ref.id}.md`);
    const current = parse(await readFile(filePath, 'utf8'));
    const { calls } = track(ref);
    await writeFile(filePath, render({ ...current, comment: 'edited comment' }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toEqual([]);
  });

  it('onStatusChange stays silent while the file is deleted and reports after it returns', async () => {
    const ref = await adapter.createIssue(payload);
    const filePath = path.join(dir, `${ref.id}.md`);
    const original = await readFile(filePath, 'utf8');
    const { calls } = track(ref);
    await rm(filePath);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toEqual([]);
    await writeFile(filePath, render({ ...parse(original), status: 'ack' }));
    await vi.waitFor(() => expect(calls).toEqual(['ack']), { timeout: 200 });
  });

  it('two subscriptions on one ref are independent', async () => {
    const ref = await adapter.createIssue(payload);
    const a = track(ref);
    const b = track(ref);
    a.unsubscribe();
    await bump(ref, 'ack');
    await vi.waitFor(() => expect(b.calls).toEqual(['ack']), { timeout: 200 });
    expect(a.calls).toEqual([]);
  });

  it('unsubscribe releases the watcher', async () => {
    const ref = await adapter.createIssue(payload);
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    const before = timers();
    const { unsubscribe } = track(ref);
    expect(timers()).toBeGreaterThan(before);
    unsubscribe();
    expect(timers()).toBe(before);
  });
});
