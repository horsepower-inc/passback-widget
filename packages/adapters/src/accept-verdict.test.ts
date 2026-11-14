import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse, render, type InboxFile } from '@passback/inbox';
import { acceptVerdict } from './accept-verdict';

const A = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const AT = '2026-10-24T09:15:30.123Z';
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

describe('acceptVerdict', () => {
  let root: string;
  let inbox: string;
  let target: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-verdict-'));
    inbox = path.join(root, 'inbox');
    target = path.join(inbox, `${A}.md`);
    await mkdir(inbox, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const put = (file: InboxFile) => writeFile(target, render(file));
  const raw = () => readFile(target, 'utf8');
  const read = async () => parse(await raw());
  const send = (verdict: string) => acceptVerdict(root, { v: 1, markId: A, verdict }, now);

  it('accepts a proposed mark and records the accept verdict on the current iteration', async () => {
    await put(makeFile());
    expect(await send('accept')).toEqual({ ok: true });
    const file = await read();
    expect(file.status).toBe('accepted');
    expect(file.iterations[0]?.human).toEqual({ at: AT, verdict: { kind: 'accept' } });
  });

  it('withdraws a mark in any status but withdrawn and keeps its iterations', async () => {
    for (const status of ['new', 'ack', 'proposed', 'verified', 'accepted', 'declined'] as const) {
      const before = makeFile({ status });
      await put(before);
      expect(await send('withdraw')).toEqual({ ok: true });
      expect(await read()).toEqual({ ...parse(render(before)), status: 'withdrawn' });
    }
  });

  it('parks and unparks without changing the status and unparking leaves no parked line', async () => {
    await put(makeFile());
    expect(await send('park')).toEqual({ ok: true });
    expect(await read()).toEqual({ ...parse(render(makeFile())), parked: true });
    expect(await raw()).toContain('parked: true');
    expect(await send('unpark')).toEqual({ ok: true });
    expect(await raw()).not.toContain('parked');
    expect((await read()).status).toBe('proposed');
  });

  it('treats a repeat of an applied verdict as ok and rewrites nothing', async () => {
    const cases: [string, InboxFile][] = [
      ['accept', makeFile()],
      ['withdraw', makeFile({ status: 'withdrawn' })],
      ['park', makeFile({ parked: true })],
      ['unpark', makeFile()],
    ];
    for (const [verdict, file] of cases) {
      await put(file);
      if (verdict === 'accept') await send('accept');
      const before = await raw();
      expect(await send(verdict)).toEqual({ ok: true });
      expect(await raw()).toBe(before);
      expect(await readdir(inbox)).toEqual([`${A}.md`]);
    }
  });

  it('returns illegal and leaves the file untouched for a move the rules refuse', async () => {
    const cases: [string, InboxFile][] = [
      ['accept', makeFile({ status: 'new', iterations: [] })],
      ['accept', makeFile({ status: 'withdrawn' })],
      ['park', makeFile({ status: 'accepted' })],
      ['unpark', makeFile({ status: 'withdrawn', parked: true })],
    ];
    for (const [verdict, file] of cases) {
      await put(file);
      const before = await raw();
      expect(await send(verdict)).toEqual({ ok: false, error: 'illegal' });
      expect(await raw()).toBe(before);
    }
  });

  it('returns invalid for a bad payload and missing for an absent file and never throws', async () => {
    await put(makeFile());
    const before = await raw();
    expect(await acceptVerdict(root, { v: 1, markId: A, verdict: 'nope' }, now)).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(await acceptVerdict(root, null, now)).toEqual({ ok: false, error: 'invalid' });
    expect(await raw()).toBe(before);
    await rm(target);
    expect(await send('accept')).toEqual({ ok: false, error: 'missing' });
    await writeFile(target, 'not an inbox file');
    expect(await send('accept')).toEqual({ ok: false, error: 'missing' });
    expect(await acceptVerdict('/nonexistent/dir', { v: 1, markId: A, verdict: 'park' })).toEqual({
      ok: false,
      error: 'missing',
    });
  });

  it('leaves no temporary file in the inbox directory', async () => {
    await put(makeFile());
    await send('park');
    await send('withdraw');
    await send('accept');
    expect(await readdir(inbox)).toEqual([`${A}.md`]);
  });
});
