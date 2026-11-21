// the daemon's inbox operations, built only on @passback/inbox — never
// reimplement the format or its legal moves here.

import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendReply, parse, render, transition, type InboxFile } from '@passback/inbox';

/** Throws unless `id` is a plain name: no path separators, not `.` or `..`, not empty. */
function assertPlainName(id: string): void {
  if (id === '' || id === '.' || id === '..' || id.includes('/') || id.includes('\\')) {
    throw new Error(`not a plain name: ${id}`);
  }
}

function markPath(root: string, id: string): string {
  return path.join(root, `${id}.md`);
}

/** Writes a per-call temp file then renames it over `path`, so concurrent writers to the same
 * mark never share a temp name and a reader never sees a half-written file. */
async function writeAtomically(target: string, text: string): Promise<void> {
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, text, { flag: 'wx' });
  await rename(tmp, target);
}

/** Reads and parses `<root>/<id>.md`; `undefined` for a missing or unparseable file. */
async function readMark(root: string, id: string): Promise<InboxFile | undefined> {
  try {
    return parse(await readFile(markPath(root, id), 'utf8'));
  } catch {
    return undefined;
  }
}

/** True when `file` still needs an agent move: a fresh mark, or an acked mark with no reply yet on its current iteration. A parked mark never does. */
export function needsAgent(file: InboxFile): boolean {
  if (file.parked === true) return false;
  if (file.status === 'new') return true;
  if (file.status !== 'ack') return false;
  const current = file.iterations.find((it) => it.n === file.iteration);
  return current?.agent === undefined;
}

/** The reporter's words on a reopened mark: an `ack` mark at iteration 2 or later with no agent reply on
 * its current iteration, whose previous iteration carries a comment or decline. `undefined` otherwise. */
export function reopenedFeedback(
  file: InboxFile,
): { iteration: number; comment: string } | undefined {
  if (file.status !== 'ack' || file.iteration < 2) return undefined;
  const current = file.iterations.find((it) => it.n === file.iteration);
  if (current?.agent !== undefined) return undefined;
  const comment = verdictComment(
    file.iterations.find((it) => it.n === file.iteration - 1)?.human?.verdict,
  );
  return comment === undefined ? undefined : { iteration: file.iteration, comment };
}

function verdictComment(
  verdict: NonNullable<InboxFile['iterations'][number]['human']>['verdict'] | undefined,
): string | undefined {
  if (verdict?.kind === 'comment') return verdict.text;
  if (verdict?.kind === 'decline') return verdict.reason;
  return undefined;
}

/** Every `.md` entry of `root` that `needsAgent`, sorted by id ascending. `[]` for a missing root. */
export async function listNeedingAgent(root: string): Promise<InboxFile[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const marks: InboxFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    try {
      const file = parse(await readFile(path.join(root, entry.name), 'utf8'));
      if (needsAgent(file)) marks.push(file);
    } catch {
      continue;
    }
  }
  return marks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Moves `new` to `ack` on disk and returns the written file; `undefined` (writes nothing) otherwise. */
export async function ackMark(root: string, id: string): Promise<InboxFile | undefined> {
  assertPlainName(id);
  const file = await readMark(root, id);
  if (!file || file.status !== 'new') return undefined;
  const written = { ...file, status: transition(file.status, 'ack', 'agent') };
  await writeAtomically(markPath(root, id), render(written));
  return written;
}

/** Records the agent's `reply` and moves `ack` to `proposed`; `undefined` (writes nothing) otherwise. */
export async function proposeMark(
  root: string,
  id: string,
  reply: { at: string; text: string },
): Promise<InboxFile | undefined> {
  assertPlainName(id);
  const file = await readMark(root, id);
  if (!file || file.status !== 'ack') return undefined;
  const written = appendReply(file, reply);
  await writeAtomically(markPath(root, id), render(written));
  return written;
}

/** Moves `proposed` to `verified` on disk (the widget's re-measure closed a mark at delta 0); `undefined` (writes nothing) otherwise. */
export async function verifyMark(root: string, id: string): Promise<InboxFile | undefined> {
  assertPlainName(id);
  const file = await readMark(root, id);
  if (!file || file.status !== 'proposed') return undefined;
  const written = { ...file, status: transition(file.status, 'verified', 'widget') };
  await writeAtomically(markPath(root, id), render(written));
  return written;
}

const OPEN_STATUSES = ['new', 'ack', 'proposed', 'verified'] as const;

/** Flags a mark whose element no longer resolves after HMR as `orphaned: true`, status unchanged; `undefined` (writes nothing) otherwise. */
export async function orphanMark(root: string, id: string): Promise<InboxFile | undefined> {
  assertPlainName(id);
  const file = await readMark(root, id);
  if (!file || file.orphaned === true) return undefined;
  if (!(OPEN_STATUSES as readonly string[]).includes(file.status)) return undefined;
  const written = { ...file, orphaned: true };
  await writeAtomically(markPath(root, id), render(written));
  return written;
}
