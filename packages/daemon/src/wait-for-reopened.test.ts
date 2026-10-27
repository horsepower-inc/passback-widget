import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, type InboxFile } from '@passback/inbox';
import { handedOverCount, waitForMarks } from './wait-for-marks';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pb-wait-reopened-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeFile(overrides: Partial<InboxFile> & { id: string }): InboxFile {
  return {
    schemaVersion: 1,
    batchId: overrides.id,
    status: 'new',
    iteration: 1,
    route: '/',
    selector: '[data-testid=price]',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [],
    ...overrides,
  };
}

function reopenedFile(id: string, iteration: number): InboxFile {
  const iterations: InboxFile['iterations'] = [];
  for (let n = 1; n < iteration; n++) {
    iterations.push({
      n,
      agent: { at: '2026-09-19T14:05:00Z', text: 'fixed' },
      human: { at: '2026-09-19T14:10:00Z', verdict: { kind: 'comment', text: `again ${n}` } },
    });
  }
  return makeFile({ id, status: 'ack', iteration, iterations });
}

async function put(file: InboxFile): Promise<void> {
  await writeFile(path.join(dir, `${file.id}.md`), render(file));
}

const wait = (): Promise<InboxFile[]> => waitForMarks({ root: dir, timeoutMs: 150, pollMs: 10 });

describe('waitForMarks reopened', () => {
  it('hands a reopened mark to the agent once per iteration', async () => {
    await put(reopenedFile('a1', 2));
    const first = await wait();
    expect(first.map((m) => m.id)).toEqual(['a1']);
    expect(first[0]?.status).toBe('ack');
    expect(await wait()).toEqual([]);
  });

  it('does not hand over an acked first-iteration mark the agent is working on', async () => {
    await put(makeFile({ id: 'b1', status: 'ack' }));
    expect(await wait()).toEqual([]);
  });

  it('hands over a mark reopened again on its next iteration', async () => {
    await put(reopenedFile('c1', 2));
    expect((await wait()).map((m) => m.iteration)).toEqual([2]);
    await put(reopenedFile('c1', 3));
    expect((await wait()).map((m) => m.iteration)).toEqual([3]);
  });

  it('hands a reopened mark and a new mark together, in id order', async () => {
    await put(makeFile({ id: 'd2' }));
    await put(reopenedFile('d1', 2));
    await put(makeFile({ id: 'd3' }));
    const marks = await wait();
    expect(marks.map((m) => m.id)).toEqual(['d1', 'd2', 'd3']);
    expect(marks.map((m) => m.status)).toEqual(['ack', 'ack', 'ack']);
  });

  it('forgets an iteration once the mark is reopened again', async () => {
    await put(reopenedFile('e1', 2));
    expect((await wait()).map((m) => m.iteration)).toEqual([2]);
    await put(reopenedFile('e1', 3));
    expect((await wait()).map((m) => m.iteration)).toEqual([3]);
    expect(handedOverCount(dir)).toBe(1);
  });

  it('forgets a handed-over mark once its file is gone', async () => {
    await put(reopenedFile('f1', 2));
    expect((await wait()).map((m) => m.id)).toEqual(['f1']);
    await rm(path.join(dir, 'f1.md'));
    expect(await wait()).toEqual([]);
    expect(handedOverCount(dir)).toBe(0);
  });

  it('forgets an iteration once the agent has answered it', async () => {
    await put(reopenedFile('g1', 2));
    expect((await wait()).map((m) => m.id)).toEqual(['g1']);
    const answered = reopenedFile('g1', 2);
    answered.iterations.push({ n: 2, agent: { at: '2026-09-19T14:15:00Z', text: 'fixed again' } });
    await put(answered);
    expect(await wait()).toEqual([]);
    expect(handedOverCount(dir)).toBe(0);
  });

  it('still hands a waiting reopened mark over only once', async () => {
    await put(reopenedFile('h1', 2));
    expect((await wait()).map((m) => m.id)).toEqual(['h1']);
    expect(await wait()).toEqual([]);
    expect(handedOverCount(dir)).toBe(1);
    expect(await wait()).toEqual([]);
    expect(handedOverCount(dir)).toBe(1);
  });
});
