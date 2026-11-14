// (passback:clear). The plugin-side writer for the panel's clear: remove
// comments from `.passback/` by scope. A comment an agent holds (status `ack`) is withdrawn and
// kept, so `passback_wait` can report it. The plugin cannot reach the daemon, so this works on
// the files directly.

import { readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse, type InboxFile } from '@passback/inbox';
import { ChannelClear, type ChannelCleared } from '@passback/schema';
import { acceptVerdict } from './accept-verdict';

export type ClearResult =
  { ok: true; cleared: ChannelCleared } | { ok: false; error: 'invalid' | 'failed' };

type Scope = ChannelClear['scope'];

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

/** The entry names of a folder; a missing folder has none. */
async function list(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/** True only when `file` is confirmed missing; any other stat error throws. */
async function gone(file: string): Promise<boolean> {
  try {
    await stat(file);
    return false;
  } catch (err) {
    if (isMissing(err)) return true;
    throw err;
  }
}

/** The parsed comment, undefined when it does not parse, null when it vanished since the
 * listing; any other read error throws. */
async function readComment(file: string): Promise<InboxFile | undefined | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
  try {
    return parse(text);
  } catch {
    return undefined;
  }
}

function selects(scope: Scope, file: InboxFile | undefined): boolean {
  if (scope === 'workspace') return true;
  if (!file) return false;
  if (scope === 'fixed') return file.status === 'accepted' || file.status === 'verified';
  return file.sentToTracker !== undefined;
}

type Counts = { comments: number; attachments: number; answers: number; done: number };

/** Deletes (or, when `dry`, only counts) one selected comment; `answer` is its answer file. */
async function removeComment(inbox: string, id: string, answer: string | undefined, dry: boolean) {
  const attachments = (await list(path.join(inbox, id))).filter((n) => n !== 'payload.json');
  if (!dry) {
    if (answer) await rm(answer, { force: true });
    await rm(path.join(inbox, `${id}.md`), { force: true });
    await rm(path.join(inbox, id), { recursive: true, force: true });
  }
  return attachments.length;
}

/** Marks a held comment withdrawn; a withdraw that is not written fails the clear, unless its
 * file vanished since the listing. */
async function withdraw(passbackDir: string, id: string) {
  const result = await acceptVerdict(passbackDir, { v: 1, markId: id, verdict: 'withdraw' });
  if (result.ok) return;
  if (result.error === 'missing' && (await gone(path.join(passbackDir, 'inbox', `${id}.md`)))) {
    return;
  }
  throw new Error(`could not withdraw ${id}: ${result.error}`);
}

async function clearComments(passbackDir: string, scope: Scope, dry: boolean): Promise<Counts> {
  const counts = { comments: 0, attachments: 0, answers: 0, done: 0 };
  const inbox = path.join(passbackDir, 'inbox');
  const answers = path.join(passbackDir, 'answers');
  const answered = new Set(await list(answers));
  for (const name of (await list(inbox)).filter((n) => n.endsWith('.md'))) {
    const id = name.slice(0, -'.md'.length);
    const file = await readComment(path.join(inbox, name));
    if (file === null || !selects(scope, file)) continue;
    if (file?.status === 'ack' && !dry) {
      await withdraw(passbackDir, id);
      continue;
    }
    const hasAnswer = scope !== 'workspace' && answered.has(`${id}.json`);
    counts.comments += 1;
    counts.answers += hasAnswer ? 1 : 0;
    const answer = hasAnswer ? path.join(answers, `${id}.json`) : undefined;
    counts.attachments += await removeComment(inbox, id, answer, dry);
  }
  return counts;
}

/** The workspace scope also empties answers, outbox and done; the folders stay. */
async function clearFolders(passbackDir: string, dry: boolean) {
  const names = async (sub: string) => list(path.join(passbackDir, sub));
  const answers = (await names('answers')).length;
  const done = (await names('done')).filter((n) => n.endsWith('.md')).length;
  if (!dry) {
    for (const sub of ['answers', 'outbox', 'done']) {
      for (const n of await names(sub)) {
        await rm(path.join(passbackDir, sub, n), { recursive: true, force: true });
      }
    }
  }
  return { answers, done };
}

async function clear(passbackDir: string, scope: Scope, settings: boolean): Promise<Counts> {
  // Settings counts what workspace would remove and deletes the whole folder afterwards.
  const counts = await clearComments(passbackDir, scope, settings);
  if (scope === 'workspace') {
    const folders = await clearFolders(passbackDir, settings);
    counts.answers += folders.answers;
    counts.done += folders.done;
  }
  if (settings) await rm(passbackDir, { recursive: true, force: true });
  return counts;
}

/** Removes the comments `input` (a `passback:clear` payload) selects from `passbackDir`, and
 * answers with the counts. Never throws or rejects: a bad request is `invalid` and touches
 * nothing; a file-system error other than a missing file is `failed`, and a repeat finishes
 * the job. */
export async function clearInbox(passbackDir: string, input: unknown): Promise<ClearResult> {
  const parsed = ChannelClear.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { scope } = parsed.data;
  const settings = parsed.data.settings === true;
  try {
    const counts = await clear(passbackDir, scope, settings);
    return { ok: true, cleared: { v: 1, scope, ...counts, settings } };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
