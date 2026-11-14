// The HMR surface for passback:reopen: record the reporter's comment as the
// human verdict, open the next iteration of the mark's inbox file and queue a status event. The
// plugin cannot reach the daemon (filesystem IPC only), so the plugin side writes the inbox, the
// way acceptOrphaned does.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyVerdict, parse, render, type InboxFile } from '@passback/inbox';
import { ChannelReopen } from '@passback/schema';

/** True when this exact reopen was already applied: the mark waits at `ack` on the next iteration
 * and the iteration before it holds the same comment as the human verdict. */
function isRepeat(file: InboxFile, comment: string): boolean {
  if (file.status !== 'ack' || file.iteration < 2) return false;
  const current = file.iterations.find((it) => it.n === file.iteration);
  if (current?.agent) return false;
  const verdict = file.iterations.find((it) => it.n === file.iteration - 1)?.human?.verdict;
  return verdict?.kind === 'comment' && verdict.text === comment;
}

async function writeAtomic(target: string, text: string): Promise<void> {
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, text, { flag: 'wx' });
  await rename(tmp, target);
}

async function writeInbox(target: string, file: InboxFile, at: string, comment: string) {
  const next = applyVerdict(file, { at, verdict: { kind: 'comment', text: comment } });
  await writeAtomic(target, render(next));
}

async function writeQueued(passbackDir: string, markId: string, at: string): Promise<void> {
  const outbox = path.join(passbackDir, 'outbox');
  await mkdir(outbox, { recursive: true });
  const stem = `${at.replace(/[:.]/g, '-')}-${markId}-queued`;
  const text = `${JSON.stringify({ v: 1, markId, state: 'queued', at })}\n`;
  await writeAtomic(path.join(outbox, `${stem}.json`), text);
}

async function apply(passbackDir: string, input: unknown, at: string): Promise<boolean> {
  const parsed = ChannelReopen.safeParse(input);
  if (!parsed.success) return false;
  const { markId, comment } = parsed.data;
  const target = path.join(passbackDir, 'inbox', `${markId}.md`);
  const file = parse(await readFile(target, 'utf8'));
  if (!isRepeat(file, comment)) await writeInbox(target, file, at, comment);
  try {
    await writeQueued(passbackDir, markId, at);
  } catch {
    // the inbox write is the commit; the widget's retry is a repeat and writes the status again
  }
  return true;
}

/** Turns an unknown `passback:reopen` payload into the next iteration of the mark's inbox file
 * under `<passbackDir>/inbox` and a `queued` status event under `<passbackDir>/outbox`. Returns
 * true when applied or a repeat of an applied reopen, false otherwise. Never throws or rejects. */
export async function acceptReopen(
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
