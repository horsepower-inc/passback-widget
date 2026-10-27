import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyVerdict, render, type InboxFile } from '@passback/inbox';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archiveDone } from './archive-done';

const HOUR = 3_600_000;
const NOW = new Date('2026-10-26T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

let dir: string;
let inbox: string;
let done: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pb-archive-done-'));
  inbox = path.join(dir, 'inbox');
  done = path.join(dir, 'done');
  await mkdir(inbox, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function proposed(id: string): InboxFile {
  return {
    id,
    schemaVersion: 1,
    batchId: 'B1',
    status: 'proposed',
    iteration: 1,
    route: '/home',
    selector: '#hero',
    createdAt: '2026-10-01T10:00:00.000Z',
    comment: `comment ${id}`,
    annotations: [],
    iterations: [{ n: 1, agent: { at: '2026-10-01T11:00:00.000Z', text: 'fixed' } }],
  };
}

function accepted(id: string, acceptedAgo: number): InboxFile {
  return applyVerdict(proposed(id), { at: ago(acceptedAgo), verdict: { kind: 'accept' } });
}

async function put(file: InboxFile, withFolder = false): Promise<void> {
  await writeFile(path.join(inbox, `${file.id}.md`), render(file));
  if (withFolder) {
    await mkdir(path.join(inbox, file.id), { recursive: true });
    await writeFile(path.join(inbox, file.id, 'payload.json'), '{}');
  }
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

describe('archiveDone', () => {
  it('moves an accepted comment and its attachment folder to done after 24 hours', async () => {
    await put(accepted('A1', 24 * HOUR), true);
    const { moved } = await archiveDone(dir, NOW);
    expect(moved).toEqual(['A1']);
    expect(await exists(path.join(done, 'A1.md'))).toBe(true);
    expect(await exists(path.join(done, 'A1', 'payload.json'))).toBe(true);
    expect(await exists(path.join(inbox, 'A1.md'))).toBe(false);
    expect(await exists(path.join(inbox, 'A1'))).toBe(false);
  });

  it('keeps an accepted comment younger than 24 hours and every comment that is not accepted', async () => {
    await put(accepted('A1', 24 * HOUR - 1));
    await put(proposed('A2'));
    await put({ ...proposed('A3'), status: 'new', iterations: [] });
    await writeFile(path.join(inbox, 'A4.md'), 'not an inbox file');
    expect((await archiveDone(dir, NOW)).moved).toEqual([]);
    expect((await readdir(inbox)).sort()).toEqual(['A1.md', 'A2.md', 'A3.md', 'A4.md']);
    expect(await exists(done)).toBe(false);
  });

  it('keeps a comment whose done target already exists and moves the others', async () => {
    await put(accepted('A1', 48 * HOUR), true);
    await put(accepted('A2', 48 * HOUR));
    await put(accepted('A3', 48 * HOUR));
    await mkdir(path.join(done, 'A1'), { recursive: true });
    await writeFile(path.join(done, 'A3.md'), 'older');
    const { moved } = await archiveDone(dir, NOW);
    expect(moved).toEqual(['A2']);
    expect(await exists(path.join(inbox, 'A1.md'))).toBe(true);
    expect(await exists(path.join(inbox, 'A1', 'payload.json'))).toBe(true);
    expect(await exists(path.join(inbox, 'A3.md'))).toBe(true);
    expect(await exists(path.join(done, 'A2.md'))).toBe(true);
  });

  it('moves the file on the next call when only the folder was moved before a crash', async () => {
    await put(accepted('A1', 48 * HOUR));
    // The crash left the file in the inbox and the folder already moved to done.
    await mkdir(path.join(done, 'A1'), { recursive: true });
    await writeFile(path.join(done, 'A1', 'payload.json'), '{}');
    const { moved } = await archiveDone(dir, NOW);
    expect(moved).toEqual(['A1']);
    expect(await exists(path.join(done, 'A1.md'))).toBe(true);
    expect(await exists(path.join(inbox, 'A1.md'))).toBe(false);
  });

  it('moves nothing on a second call and returns no ids for a missing inbox directory', async () => {
    await put(accepted('A1', 48 * HOUR), true);
    expect((await archiveDone(dir, NOW)).moved).toEqual(['A1']);
    expect((await archiveDone(dir, NOW)).moved).toEqual([]);
    expect(await archiveDone(path.join(dir, 'missing'), NOW)).toEqual({ moved: [] });
  });
});
