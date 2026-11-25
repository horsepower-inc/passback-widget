import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse, render, type InboxFile } from '@passback/inbox';
import { acceptReopen } from './accept-reopen';

const A = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const AT = '2026-10-03T09:15:30.123Z';
const now = () => new Date(AT);

function makeFile(overrides: Partial<InboxFile> = {}): InboxFile {
  return {
    id: A,
    schemaVersion: 1,
    batchId: A,
    category: 'visual',
    status: 'proposed',
    iteration: 1,
    route: '/products/:id',
    selector: '[data-testid=price]',
    buildId: '3f2a9c1',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [{ n: 1, agent: { at: '2026-09-19T14:05:00Z', text: 'fixed the padding' } }],
    ...overrides,
  };
}

describe('acceptReopen', () => {
  let root: string;
  let inbox: string;
  let outbox: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-reopen-'));
    inbox = path.join(root, 'inbox');
    outbox = path.join(root, 'outbox');
    await mkdir(inbox, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function put(file: InboxFile): Promise<void> {
    await writeFile(path.join(inbox, `${file.id}.md`), render(file));
  }

  async function read(): Promise<InboxFile> {
    return parse(await readFile(path.join(inbox, `${A}.md`), 'utf8'));
  }

  async function outboxNames(): Promise<string[]> {
    return (await readdir(outbox).catch(() => [])).sort();
  }

  const reopen = (comment = 'still wrong') => ({ v: 1, markId: A, comment });

  it('records the comment as the human verdict, opens the next iteration and moves the status to ack', async () => {
    await put(makeFile());
    expect(await acceptReopen(root, reopen(), now)).toBe(true);
    const after = await read();
    expect(after.status).toBe('ack');
    expect(after.iteration).toBe(2);
    expect(after.iterations.find((it) => it.n === 1)?.human).toEqual({
      at: AT,
      verdict: { kind: 'comment', text: 'still wrong' },
    });
    expect(after.iterations.find((it) => it.n === 2)?.agent).toBeUndefined();
  });

  it('reopens a verified mark the same way', async () => {
    await put(makeFile({ status: 'verified' }));
    expect(await acceptReopen(root, reopen(), now)).toBe(true);
    const after = await read();
    expect(after.status).toBe('ack');
    expect(after.iteration).toBe(2);
  });

  it('writes one queued status event for the mark to the outbox', async () => {
    await put(makeFile());
    await acceptReopen(root, reopen(), now);
    const names = await outboxNames();
    expect(names).toEqual([`2026-10-03T09-15-30-123Z-${A}-queued.json`]);
    const text = await readFile(path.join(outbox, names[0] ?? ''), 'utf8');
    expect(text).toBe(`${JSON.stringify({ v: 1, markId: A, state: 'queued', at: AT })}\n`);
  });

  it('leaves a mark that is new, ack, accepted or withdrawn untouched and writes no status', async () => {
    for (const status of ['new', 'ack', 'accepted', 'withdrawn'] as const) {
      await put(makeFile({ status }));
      const before = await readFile(path.join(inbox, `${A}.md`), 'utf8');
      expect(await acceptReopen(root, reopen(), now)).toBe(false);
      expect(await readFile(path.join(inbox, `${A}.md`), 'utf8')).toBe(before);
    }
    expect(await outboxNames()).toEqual([]);
  });

  it('returns false for a missing file, a blank comment, a non-ULID id or v other than 1', async () => {
    expect(await acceptReopen(root, reopen(), now)).toBe(false);
    await put(makeFile());
    const before = await readFile(path.join(inbox, `${A}.md`), 'utf8');
    expect(await acceptReopen(root, reopen('   '), now)).toBe(false);
    expect(await acceptReopen(root, { v: 1, markId: '../x', comment: 'no' }, now)).toBe(false);
    expect(await acceptReopen(root, { v: 2, markId: A, comment: 'no' }, now)).toBe(false);
    expect(await acceptReopen(root, null, now)).toBe(false);
    expect(await readFile(path.join(inbox, `${A}.md`), 'utf8')).toBe(before);
    expect(await outboxNames()).toEqual([]);
  });

  it('keeps a multi-line comment that looks like an iteration heading readable by the parser', async () => {
    await put(makeFile());
    const comment = 'first line\n## Iteration 9\nlast line';
    expect(await acceptReopen(root, reopen(comment), now)).toBe(true);
    const after = await read();
    expect(after.iteration).toBe(2);
    expect(after.iterations.find((it) => it.n === 1)?.human?.verdict).toEqual({
      kind: 'comment',
      text: comment,
    });
    expect(after.iterations.some((it) => it.n === 9)).toBe(false);
  });

  it('answers a repeat of the same reopen with a second queued status and no second verdict', async () => {
    await put(makeFile());
    await acceptReopen(root, reopen(), now);
    const first = await readFile(path.join(inbox, `${A}.md`), 'utf8');
    const later = () => new Date('2026-10-03T09:15:36.000Z');
    expect(await acceptReopen(root, reopen(), later)).toBe(true);
    expect(await readFile(path.join(inbox, `${A}.md`), 'utf8')).toBe(first);
    expect(await outboxNames()).toHaveLength(2);
  });

  it('leaves no temp file behind in the inbox or the outbox', async () => {
    await put(makeFile());
    await acceptReopen(root, reopen(), now);
    const names = [...(await readdir(inbox)), ...(await outboxNames())];
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});
