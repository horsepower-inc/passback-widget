// The plugin cannot reach the daemon (filesystem IPC
// only), so the plugin side stores the reporter's answer where `waitForAnswer` reads it and queues
// a `running` status, the way acceptReopen writes its files.

import { randomUUID } from 'node:crypto';
import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ChannelAnswer } from '@passback/schema';

async function writeAtomic(target: string, text: string): Promise<void> {
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, text, { flag: 'wx' });
  await rename(tmp, target);
}

async function writeRunning(passbackDir: string, markId: string, at: string): Promise<void> {
  const outbox = path.join(passbackDir, 'outbox');
  await mkdir(outbox, { recursive: true });
  const stem = `${at.replace(/[:.]/g, '-')}-${markId}-running`;
  const text = `${JSON.stringify({ v: 1, markId, state: 'running', at })}\n`;
  await writeAtomic(path.join(outbox, `${stem}.json`), text);
}

async function apply(passbackDir: string, input: unknown, at: string): Promise<boolean> {
  const parsed = ChannelAnswer.safeParse(input);
  if (!parsed.success) return false;
  const { markId, text } = parsed.data;
  await access(path.join(passbackDir, 'inbox', `${markId}.md`));
  const answers = path.join(passbackDir, 'answers');
  await mkdir(answers, { recursive: true });
  const body = `${JSON.stringify({ v: 1, markId, text, at })}\n`;
  await writeAtomic(path.join(answers, `${markId}.json`), body);
  try {
    await writeRunning(passbackDir, markId, at);
  } catch {
    // the answer is the commit; the widget's retry writes the status again
  }
  return true;
}

/** Turns an unknown `passback:answer` payload into `<passbackDir>/answers/<markId>.json` and a
 * `running` status event under `<passbackDir>/outbox`. Returns false for an invalid payload, a mark
 * without an inbox file, or a failed answer write. Never throws or rejects. */
export async function acceptAnswer(
  passbackDir: string,
  input: unknown,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  try {
    return await apply(passbackDir, input, now().toISOString());
  } catch {
    return false;
  }
}
