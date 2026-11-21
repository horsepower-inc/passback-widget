// Accepted comments leave the inbox 24 hours after the accept verdict: the attachment folder and
// the .md file move to `<passbackDir>/done/`. `listInbox` calls it before it reads the inbox.

import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@passback/inbox';

const DONE_AFTER_MS = 86_400_000;

const exists = (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false,
  );

async function dueId(file: string, now: number): Promise<string | undefined> {
  try {
    const f = parse(await readFile(file, 'utf8'));
    if (f.status !== 'accepted') return undefined;
    const human = f.iterations.find((it) => it.n === f.iteration)?.human;
    if (human?.verdict.kind !== 'accept') return undefined;
    return now - Date.parse(human.at) >= DONE_AFTER_MS ? path.basename(file, '.md') : undefined;
  } catch {
    return undefined;
  }
}

async function move(inboxDir: string, doneDir: string, id: string): Promise<boolean> {
  try {
    const folder = path.join(inboxDir, id);
    const hasFolder = await exists(folder);
    // A folder already in done with none left in the inbox is a crash between the two renames.
    if (
      (await exists(path.join(doneDir, `${id}.md`))) ||
      (hasFolder && (await exists(path.join(doneDir, id))))
    ) {
      return false;
    }
    await mkdir(doneDir, { recursive: true });
    if (hasFolder) await rename(folder, path.join(doneDir, id));
    await rename(path.join(inboxDir, `${id}.md`), path.join(doneDir, `${id}.md`));
    return true;
  } catch {
    return false;
  }
}

/** Moves accepted comments whose accept verdict is 24 hours old or older from `<passbackDir>/inbox`
 * to `<passbackDir>/done`, never overwriting. Returns the ids moved, sorted; never throws or rejects. */
export async function archiveDone(
  passbackDir: string,
  now: Date = new Date(),
): Promise<{ moved: string[] }> {
  try {
    const inboxDir = path.join(passbackDir, 'inbox');
    const doneDir = path.join(passbackDir, 'done');
    const names = (await readdir(inboxDir)).filter((n) => n.endsWith('.md'));
    const due = await Promise.all(names.map((n) => dueId(path.join(inboxDir, n), now.getTime())));
    const ids = due.filter((id): id is string => id !== undefined);
    const results = await Promise.all(ids.map((id) => move(inboxDir, doneDir, id)));
    return { moved: ids.filter((_, i) => results[i]).sort() };
  } catch {
    return { moved: [] };
  }
}
