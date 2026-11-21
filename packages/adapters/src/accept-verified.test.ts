import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse, render, type InboxFile } from '@passback/inbox';
import { acceptVerified } from './accept-verified';

const A = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const B = '01J8Z3K4M5N6P7Q8R9S0T1V2W4';
const C = '01J8Z3K4M5N6P7Q8R9S0T1V2W5';
const D = '01J8Z3K4M5N6P7Q8R9S0T1V2W6';
const E = '01J8Z3K4M5N6P7Q8R9S0T1V2W7';
const F = '01J8Z3K4M5N6P7Q8R9S0T1V2W8';

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

describe('acceptVerified', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-verified-'));
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

  it('moves a proposed mark to verified and changes no other field', async () => {
    const file = makeFile({
      id: A,
      status: 'proposed',
      iteration: 2,
      comment: 'gap too wide',
      annotations: [{ type: 'gap', a: 'self', b: 'next', expected: 8, actual: 12 }],
    });
    await put(file);
    expect(await acceptVerified(dir, { v: 1, markIds: [A] })).toEqual([A]);
    expect(await read(A)).toEqual({ ...file, status: 'verified' });
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('leaves new, ack, accepted, declined and verified marks alone and returns only the ids it moved', async () => {
    await put(makeFile({ id: A, status: 'new' }));
    await put(makeFile({ id: B, status: 'ack' }));
    await put(makeFile({ id: C, status: 'accepted' }));
    await put(makeFile({ id: D, status: 'declined' }));
    await put(makeFile({ id: E, status: 'verified' }));
    await put(makeFile({ id: F, status: 'proposed' }));
    const ids = [A, B, C, D, E, F];
    const before = await Promise.all(ids.map((id) => readFile(path.join(dir, `${id}.md`), 'utf8')));
    expect(await acceptVerified(dir, { v: 1, markIds: ids })).toEqual([F]);
    const after = await Promise.all(ids.map((id) => readFile(path.join(dir, `${id}.md`), 'utf8')));
    expect(after.slice(0, 5)).toEqual(before.slice(0, 5));
    expect((await read(F)).status).toBe('verified');
  });

  it('skips a missing or unparseable file and keeps going', async () => {
    await put(makeFile({ id: A, status: 'proposed' }));
    await writeFile(path.join(dir, `${B}.md`), 'not an inbox file');
    await mkdir(path.join(dir, `${C}.md`));
    await put(makeFile({ id: D, status: 'proposed' }));
    expect(await acceptVerified(dir, { v: 1, markIds: [E, A, B, C, D] })).toEqual([A, D]);
    expect((await read(A)).status).toBe('verified');
    expect((await read(D)).status).toBe('verified');
  });

  it('returns nothing for an invalid payload or an id that is a path', async () => {
    await put(makeFile({ id: A, status: 'proposed' }));
    expect(await acceptVerified(dir, { v: 1, markIds: [] })).toEqual([]);
    expect(await acceptVerified(dir, { v: 1, markIds: ['../x'] })).toEqual([]);
    expect(await acceptVerified(dir, { v: 2, markIds: [A] })).toEqual([]);
    expect(await acceptVerified(dir, null)).toEqual([]);
    expect(await acceptVerified(dir, 'nope')).toEqual([]);
    expect((await read(A)).status).toBe('proposed');
  });

  it('moves nothing on a repeated message', async () => {
    await put(makeFile({ id: A, status: 'proposed' }));
    expect(await acceptVerified(dir, { v: 1, markIds: [A] })).toEqual([A]);
    expect(await acceptVerified(dir, { v: 1, markIds: [A] })).toEqual([]);
    expect((await read(A)).status).toBe('verified');
  });
});
