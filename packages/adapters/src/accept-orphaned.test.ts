import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse, render, type InboxFile } from '@passback/inbox';
import { acceptOrphaned } from './accept-orphaned';

const A = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const B = '01J8Z3K4M5N6P7Q8R9S0T1V2W4';
const C = '01J8Z3K4M5N6P7Q8R9S0T1V2W5';
const D = '01J8Z3K4M5N6P7Q8R9S0T1V2W6';

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

describe('acceptOrphaned', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-orphaned-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function put(file: InboxFile): Promise<void> {
    await writeFile(path.join(dir, `${file.id}.md`), render(file));
  }

  async function read(id: string): Promise<InboxFile> {
    return parse(await readFile(path.join(dir, `${id}.md`), 'utf8'));
  }

  it('flags an open mark orphaned and keeps its status', async () => {
    await put(makeFile({ id: A, status: 'proposed', iteration: 2 }));
    const flagged = await acceptOrphaned(dir, { v: 1, markIds: [A] });
    expect(flagged).toEqual([A]);
    const after = await read(A);
    expect(after.orphaned).toBe(true);
    expect(after.status).toBe('proposed');
    expect(after.iteration).toBe(2);
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('leaves a missing, already orphaned or accepted mark untouched', async () => {
    await put(makeFile({ id: B, orphaned: true }));
    await put(makeFile({ id: C, status: 'accepted' }));
    const before = await Promise.all(
      [B, C].map((id) => readFile(path.join(dir, `${id}.md`), 'utf8')),
    );
    const flagged = await acceptOrphaned(dir, { v: 1, markIds: [A, B, C] });
    expect(flagged).toEqual([]);
    const after = await Promise.all(
      [B, C].map((id) => readFile(path.join(dir, `${id}.md`), 'utf8')),
    );
    expect(after).toEqual(before);
    expect((await readdir(dir)).sort()).toEqual([`${B}.md`, `${C}.md`]);
  });

  it('returns an empty list for a message that is not a passback:orphaned message', async () => {
    await put(makeFile({ id: A }));
    expect(await acceptOrphaned(dir, { v: 1, markIds: [] })).toEqual([]);
    expect(await acceptOrphaned(dir, { v: 1, markIds: ['../x'] })).toEqual([]);
    expect(await acceptOrphaned(dir, null)).toEqual([]);
    expect(await acceptOrphaned(dir, 'nope')).toEqual([]);
    expect((await read(A)).orphaned).not.toBe(true);
  });

  it('flags the other ids when one id cannot be read', async () => {
    await put(makeFile({ id: A }));
    await writeFile(path.join(dir, `${B}.md`), 'not an inbox file');
    await mkdir(path.join(dir, `${C}.md`));
    await put(makeFile({ id: D, status: 'ack' }));
    const flagged = await acceptOrphaned(dir, { v: 1, markIds: [A, B, C, D] });
    expect(flagged).toEqual([A, D]);
    expect((await read(A)).orphaned).toBe(true);
    expect((await read(D)).orphaned).toBe(true);
  });
});
