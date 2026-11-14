// The daemon's wait for the reporter's answer: the plugin writes <answersDir>/<markId>.json, this reads it.

import { readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { ChannelAnswer, MarkId } from '@passback/schema';
import { systemClock } from './adapters/system-clock';
import type { CancelTimer, Clock } from './core/clock';

export type Answer = { text: string; at: string };

export type WaitForAnswerOptions = {
  answersDir: string; // <project>/.passback/answers
  markId: string;
  timeoutMs: number;
  pollMs?: number; // default 100
  signal?: AbortSignal;
  clock?: Clock; // default systemClock
};

const StoredAnswer = ChannelAnswer.extend({ at: z.iso.datetime() });

function answerPath(answersDir: string, markId: string): string {
  if (!MarkId.safeParse(markId).success) throw new Error('not a mark id: ' + markId);
  return path.join(answersDir, `${markId}.json`);
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

/** Deletes the answer file; quiet when there is none. */
export async function clearAnswer(answersDir: string, markId: string): Promise<void> {
  const file = answerPath(answersDir, markId);
  try {
    await unlink(file);
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
}

function parseAnswer(raw: string, markId: string): Answer | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = StoredAnswer.safeParse(json);
  if (!parsed.success || parsed.data.markId !== markId) return undefined;
  return { text: parsed.data.text, at: parsed.data.at };
}

/** One look at the file: a valid answer is returned (the caller deletes it), an invalid file is moved
 * aside as .bad, a missing file or directory gives undefined. */
async function readOnce(file: string, markId: string): Promise<Answer | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (isMissing(err)) return undefined;
    throw err;
  }
  const answer = parseAnswer(raw, markId);
  if (answer) return answer;
  try {
    await rename(file, `${file}.bad`);
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
  return undefined;
}

/** Waits for the answer file of `markId`. Resolves `undefined` at `timeoutMs` on the clock, on abort,
 * and at once when `signal` is already aborted. */
export function waitForAnswer(opts: WaitForAnswerOptions): Promise<Answer | undefined> {
  const { answersDir, markId, timeoutMs, signal } = opts;
  const pollMs = opts.pollMs ?? 100;
  const clock = opts.clock ?? systemClock;

  return new Promise<Answer | undefined>((resolve, reject) => {
    const file = answerPath(answersDir, markId);
    if (signal?.aborted) {
      resolve(undefined);
      return;
    }

    let settled = false;
    let pollTimer: CancelTimer | undefined;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      pollTimer?.();
      timeoutTimer();
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = (): void => finish(() => resolve(undefined));

    const poll = (): void => {
      readOnce(file, markId)
        .then(async (answer) => {
          if (settled) return;
          if (!answer) {
            pollTimer = clock.setTimer(pollMs, poll);
            return;
          }
          await clearAnswer(answersDir, markId);
          finish(() => resolve(answer));
        })
        .catch((err: unknown) => finish(() => reject(err)));
    };

    const timeoutTimer = clock.setTimer(timeoutMs, onAbort);
    signal?.addEventListener('abort', onAbort);
    poll();
  });
}
