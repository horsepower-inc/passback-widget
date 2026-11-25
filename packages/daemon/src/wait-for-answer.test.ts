import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from './core/fake-clock';
import { clearAnswer, waitForAnswer } from './wait-for-answer';

const MARK = '01J8Z3K5M7Q9R1S3T5V7W9X1Y3';
const OTHER = '01J8Z3K5M7Q9R1S3T5V7W9X1Y4';
const AT = '2026-10-02T10:00:00Z';

function answerJson(markId: string, text = 'the blue one'): string {
  return JSON.stringify({ v: 1, markId, text, at: AT });
}

describe('waitForAnswer', () => {
  let root: string;
  let dir: string;
  let file: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'passback-answer-'));
    dir = path.join(root, 'answers');
    file = path.join(dir, `${MARK}.json`);
    await mkdir(dir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('resolves with the text and time of an answer that is already there and deletes the file', async () => {
    await writeFile(file, answerJson(MARK));

    const answer = await waitForAnswer({
      answersDir: dir,
      markId: MARK,
      timeoutMs: 1000,
      clock: new FakeClock(),
    });

    expect(answer).toEqual({ text: 'the blue one', at: AT });
    expect(await readdir(dir)).toEqual([]);
  });

  it('resolves when the answer arrives after some polls', async () => {
    const clock = new FakeClock();
    const promise = waitForAnswer({ answersDir: dir, markId: MARK, timeoutMs: 10000, clock });
    await vi.waitFor(() => expect(clock.pending()).toBe(2));
    clock.advance(100);
    await vi.waitFor(() => expect(clock.pending()).toBe(2));
    await writeFile(file, answerJson(MARK, 'later'));
    clock.advance(100);

    expect(await promise).toEqual({ text: 'later', at: AT });
    expect(clock.pending()).toBe(0);
  });

  it('resolves undefined at the timeout on the injected clock and leaves no timer', async () => {
    const clock = new FakeClock();
    const promise = waitForAnswer({ answersDir: dir, markId: MARK, timeoutMs: 1000, clock });
    await vi.waitFor(() => expect(clock.pending()).toBe(2));

    clock.advance(1000);

    expect(await promise).toBeUndefined();
    expect(clock.pending()).toBe(0);
  });

  it('resolves undefined when the signal aborts, and at once when it was already aborted', async () => {
    const clock = new FakeClock();
    const controller = new AbortController();
    const promise = waitForAnswer({
      answersDir: dir,
      markId: MARK,
      timeoutMs: 10000,
      clock,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(clock.pending()).toBe(2));
    controller.abort();

    expect(await promise).toBeUndefined();
    expect(clock.pending()).toBe(0);

    const missing = path.join(root, 'nope');
    const again = await waitForAnswer({
      answersDir: missing,
      markId: MARK,
      timeoutMs: 10000,
      clock,
      signal: controller.signal,
    });
    expect(again).toBeUndefined();
    expect(clock.pending()).toBe(0);
  });

  it('moves a file that is not a valid answer aside as .bad and keeps waiting', async () => {
    await writeFile(file, 'not json');
    const clock = new FakeClock();
    const promise = waitForAnswer({ answersDir: dir, markId: MARK, timeoutMs: 10000, clock });
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual([`${MARK}.json.bad`]));
    await vi.waitFor(() => expect(clock.pending()).toBe(2));

    await writeFile(file, answerJson(MARK));
    clock.advance(100);

    expect(await promise).toEqual({ text: 'the blue one', at: AT });
    expect(await readFile(path.join(dir, `${MARK}.json.bad`), 'utf8')).toBe('not json');
  });

  it('treats an answer whose markId differs from the file name as not valid', async () => {
    await writeFile(file, answerJson(OTHER));
    const clock = new FakeClock();
    const promise = waitForAnswer({ answersDir: dir, markId: MARK, timeoutMs: 1000, clock });
    await vi.waitFor(async () => expect(await readdir(dir)).toEqual([`${MARK}.json.bad`]));
    await vi.waitFor(() => expect(clock.pending()).toBe(2));

    clock.advance(1000);

    expect(await promise).toBeUndefined();
  });

  it('rejects a mark id that is not a ULID without touching the disk', async () => {
    const missing = path.join(root, 'nope');
    const bad = '../../etc/passwd';

    await expect(
      waitForAnswer({ answersDir: missing, markId: bad, timeoutMs: 10, clock: new FakeClock() }),
    ).rejects.toThrow('not a mark id: ' + bad);
    await expect(clearAnswer(missing, bad)).rejects.toThrow('not a mark id: ' + bad);
    expect(await readdir(root)).toEqual(['answers']);
  });

  it('clearAnswer removes a waiting answer and is quiet when there is none', async () => {
    await writeFile(file, answerJson(MARK));

    await clearAnswer(dir, MARK);
    await clearAnswer(dir, MARK);
    await clearAnswer(path.join(root, 'nope'), MARK);

    expect(await readdir(dir)).toEqual([]);
  });
});
