import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acceptAnswer } from './accept-answer';

const A = '01J8Z3K4M5N6P7Q8R9S0T1V2W3';
const AT = '2026-10-03T09:15:30.123Z';
const now = () => new Date(AT);
const INBOX_TEXT = '---\nid: x\n---\nbody\n';

describe('acceptAnswer', () => {
  let root: string;
  let answers: string;
  let outbox: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-answer-'));
    answers = path.join(root, 'answers');
    outbox = path.join(root, 'outbox');
    await mkdir(path.join(root, 'inbox'), { recursive: true });
    await writeFile(path.join(root, 'inbox', `${A}.md`), INBOX_TEXT);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const readAnswer = async () =>
    JSON.parse(await readFile(path.join(answers, `${A}.json`), 'utf8'));

  it('writes the answer file with the trimmed text and the time', async () => {
    expect(await acceptAnswer(root, { v: 1, markId: A, text: '  the blue one \n' }, now)).toBe(
      true,
    );
    expect(await readAnswer()).toEqual({ v: 1, markId: A, text: 'the blue one', at: AT });
  });

  it('replaces an older answer for the same mark', async () => {
    await acceptAnswer(root, { v: 1, markId: A, text: 'first' }, now);
    await acceptAnswer(root, { v: 1, markId: A, text: 'second' }, now);
    expect((await readAnswer()).text).toBe('second');
  });

  it('queues one running status for the mark in the outbox', async () => {
    await acceptAnswer(root, { v: 1, markId: A, text: 'yes' }, now);
    expect(await readdir(outbox)).toEqual([`2026-10-03T09-15-30-123Z-${A}-running.json`]);
    const [name] = await readdir(outbox);
    const event = JSON.parse(await readFile(path.join(outbox, name as string), 'utf8'));
    expect(event).toEqual({ v: 1, markId: A, state: 'running', at: AT });
  });

  it('writes nothing for a mark without an inbox file', async () => {
    const other = '01J8Z3K4M5N6P7Q8R9S0T1V2W4';
    expect(await acceptAnswer(root, { v: 1, markId: other, text: 'yes' }, now)).toBe(false);
    expect(await readdir(root)).toEqual(['inbox']);
  });

  it('returns false and writes nothing for an invalid payload', async () => {
    const bad = [
      { v: 1, markId: A, text: '   ' },
      { v: 1, markId: A, text: 'x'.repeat(4001) },
      { v: 1, markId: 'not-a-ulid', text: 'yes' },
      { v: 2, markId: A, text: 'yes' },
      null,
    ];
    for (const input of bad) expect(await acceptAnswer(root, input, now)).toBe(false);
    expect(await readdir(root)).toEqual(['inbox']);
  });

  it('leaves no temp file behind in the answers folder or the outbox', async () => {
    await acceptAnswer(root, { v: 1, markId: A, text: 'one' }, now);
    await acceptAnswer(root, { v: 1, markId: A, text: 'two' }, now);
    const names = [...(await readdir(answers)), ...(await readdir(outbox))];
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('leaves the inbox file unchanged', async () => {
    await acceptAnswer(root, { v: 1, markId: A, text: 'yes' }, now);
    expect(await readFile(path.join(root, 'inbox', `${A}.md`), 'utf8')).toBe(INBOX_TEXT);
  });
});
