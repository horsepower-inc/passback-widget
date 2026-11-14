import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, render, type InboxFile } from '@passback/inbox';
import { MAX_BATCH_MARKS } from '@passback/schema';
import { FakeClock } from './core/fake-clock';
import { waitForMarks } from './wait-for-marks';

const hooks = vi.hoisted(() => ({
  beforeAck: undefined as ((id: string) => void | Promise<void>) | undefined,
}));

vi.mock('./inbox-store', async () => {
  const actual = await vi.importActual<typeof import('./inbox-store')>('./inbox-store');
  return {
    ...actual,
    ackMark: async (root: string, id: string) => {
      if (hooks.beforeAck) await hooks.beforeAck(id);
      return actual.ackMark(root, id);
    },
  };
});

function makeFile(overrides: Partial<InboxFile> & { id: string }): InboxFile {
  return {
    schemaVersion: 1,
    batchId: overrides.id,
    category: 'visual',
    status: 'new',
    iteration: 1,
    route: '/products/:id',
    selector: '[data-testid=price]',
    buildId: '3f2a9c1',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [],
    ...overrides,
  };
}

async function writeMark(dir: string, file: InboxFile): Promise<void> {
  await writeFile(path.join(dir, `${file.id}.md`), render(file));
}

async function readMark(dir: string, id: string): Promise<InboxFile> {
  return parse(await readFile(path.join(dir, `${id}.md`), 'utf8'));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('waitForMarks', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-wait-'));
  });

  afterEach(async () => {
    // maxRetries/retryDelay absorb an ENOTEMPTY from a rename (writeAtomically's tmp-file swap)
    // that is still settling in the OS when this recursive rmdir snapshots the directory.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    hooks.beforeAck = undefined;
  });

  it('returns a new mark within 500 ms of its arrival', async () => {
    const promise = waitForMarks({ root: dir, timeoutMs: 3000 });
    await delay(200);
    const writtenAt = Date.now();
    await writeMark(dir, makeFile({ id: '01A' }));

    const marks = await promise;

    expect(marks.map((m) => m.id)).toEqual(['01A']);
    expect(Date.now() - writtenAt).toBeLessThan(500);
  });

  it('returns marks that are already waiting on the first check', async () => {
    await writeMark(dir, makeFile({ id: '01A' }));

    const marks = await waitForMarks({ root: dir, timeoutMs: 3000, pollMs: 1000 });

    expect(marks.map((m) => m.id)).toEqual(['01A']);
  });

  it('returns every new mark found in one poll, in id order', async () => {
    await writeMark(dir, makeFile({ id: '01C' }));
    await writeMark(dir, makeFile({ id: '01A' }));
    await writeMark(dir, makeFile({ id: '01B' }));

    const marks = await waitForMarks({ root: dir, timeoutMs: 3000 });

    expect(marks.map((m) => m.id)).toEqual(['01A', '01B', '01C']);
  });

  it('returns at most MAX_BATCH_MARKS marks', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => String(i + 1).padStart(2, '0'));
    for (const id of ids) {
      await writeMark(dir, makeFile({ id }));
    }

    const marks = await waitForMarks({ root: dir, timeoutMs: 3000 });

    expect(marks).toHaveLength(MAX_BATCH_MARKS);
    const lastId = ids[ids.length - 1];
    if (lastId === undefined) throw new Error('unreachable');
    expect((await readMark(dir, lastId)).status).toBe('new');
  });

  it('the returned marks are ack on disk', async () => {
    await writeMark(dir, makeFile({ id: '01A' }));

    await waitForMarks({ root: dir, timeoutMs: 3000 });

    expect((await readMark(dir, '01A')).status).toBe('ack');
  });

  it('ignores marks that are not new', async () => {
    await writeMark(dir, makeFile({ id: '01A', status: 'ack', iterations: [] }));

    const marks = await waitForMarks({ root: dir, timeoutMs: 300 });

    expect(marks).toEqual([]);
  });

  it('resolves an empty list at the timeout', async () => {
    const marks = await waitForMarks({ root: dir, timeoutMs: 300 });

    expect(marks).toEqual([]);
  });

  it('an already aborted signal resolves an empty list without reading the inbox', async () => {
    const controller = new AbortController();
    controller.abort();
    const missingRoot = path.join(dir, 'does-not-exist');

    const marks = await waitForMarks({
      root: missingRoot,
      timeoutMs: 3000,
      signal: controller.signal,
    });

    expect(marks).toEqual([]);
    await expect(readFile(missingRoot, 'utf8')).rejects.toThrow();
  });

  it('an abort during the wait resolves an empty list', async () => {
    const controller = new AbortController();
    const promise = waitForMarks({ root: dir, timeoutMs: 3000, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);

    const marks = await promise;

    expect(marks).toEqual([]);
  });

  it('leaves no timer behind after it resolves', async () => {
    const countTimers = (): number =>
      process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
    await delay(150); // let the test worker's own startup timer, unrelated to this call, expire first
    const before = countTimers();

    await waitForMarks({ root: dir, timeoutMs: 300 });

    expect(countTimers()).toBe(before);
  });

  it('an abort during a poll makes no further ackMark calls', async () => {
    await writeMark(dir, makeFile({ id: '01A' }));
    await writeMark(dir, makeFile({ id: '01B' }));
    await writeMark(dir, makeFile({ id: '01C' }));
    const controller = new AbortController();
    hooks.beforeAck = (id) => {
      if (id === '01A') controller.abort();
    };

    const marks = await waitForMarks({ root: dir, timeoutMs: 3000, signal: controller.signal });

    expect(marks.map((m) => m.id)).toEqual(['01A']);
    expect((await readMark(dir, '01B')).status).toBe('new');
    expect((await readMark(dir, '01C')).status).toBe('new');

    // waitForMarks resolves as soon as the abort is observed, but the ack write for '01A' that
    // was already in flight still needs its rename to settle on disk before afterEach's rm(dir)
    // walks it — otherwise that walk can intermittently observe an ENOTEMPTY mid-rename.
    await delay(50);
  });

  it('an abort during a poll returns the marks that poll acked', async () => {
    await writeMark(dir, makeFile({ id: '01A' }));
    await writeMark(dir, makeFile({ id: '01B' }));
    await writeMark(dir, makeFile({ id: '01C' }));
    const controller = new AbortController();
    hooks.beforeAck = (id) => {
      if (id === '01B') controller.abort();
    };

    const marks = await waitForMarks({ root: dir, timeoutMs: 3000, signal: controller.signal });

    expect(marks.map((m) => m.id)).toEqual(['01A', '01B']);
    expect((await readMark(dir, '01B')).status).toBe('ack');
    expect((await readMark(dir, '01C')).status).toBe('new');
  });

  it('an abort during a poll that acks nothing resolves an empty list', async () => {
    await writeMark(dir, makeFile({ id: '01A' }));
    const controller = new AbortController();
    hooks.beforeAck = async (id) => {
      if (id === '01A') {
        await writeMark(dir, makeFile({ id: '01A', status: 'withdrawn' }));
        controller.abort();
      }
    };
    const startedAt = Date.now();

    const marks = await waitForMarks({ root: dir, timeoutMs: 3000, signal: controller.signal });

    expect(marks).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('an ack that fails after an acked mark returns the acked marks', async () => {
    await writeMark(dir, makeFile({ id: '01A' }));
    await writeMark(dir, makeFile({ id: '01B' }));
    await writeMark(dir, makeFile({ id: '01C' }));
    hooks.beforeAck = (id) => {
      if (id === '01B') throw new Error('boom');
    };

    const marks = await waitForMarks({ root: dir, timeoutMs: 3000 });

    expect(marks.map((m) => m.id)).toEqual(['01A']);
    expect((await readMark(dir, '01C')).status).toBe('new');
  });

  it('an ack that fails before any mark is acked rejects', async () => {
    await writeMark(dir, makeFile({ id: '01A' }));
    const err = new Error('boom');
    hooks.beforeAck = () => {
      throw err;
    };

    await expect(waitForMarks({ root: dir, timeoutMs: 3000 })).rejects.toBe(err);
  });

  it('resolves an empty list when the injected clock reaches timeoutMs', async () => {
    const clock = new FakeClock();

    const promise = waitForMarks({ root: dir, timeoutMs: 1000, clock });
    clock.advance(1000);
    const marks = await promise;

    expect(marks).toEqual([]);
    expect(clock.pending()).toBe(0);
  });

  it('polls again after pollMs of the injected clock, not real time', async () => {
    const clock = new FakeClock();

    const promise = waitForMarks({ root: dir, pollMs: 100, timeoutMs: 10000, clock });
    await vi.waitFor(() => expect(clock.pending()).toBe(2));
    await writeMark(dir, makeFile({ id: '01A' }));
    clock.advance(100);
    const marks = await promise;

    expect(marks.map((m) => m.id)).toEqual(['01A']);
  });
});
