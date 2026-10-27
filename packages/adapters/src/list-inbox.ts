// The local inbox as panel rows: one row per inbox file, newest first, for the widget's Inbox panel.
// Read-only; the Vite and Next `passback:list` handlers call it, the way they call acceptReopen.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, type InboxFile } from '@passback/inbox';
import { Element } from '@passback/schema';
import { archiveDone } from './archive-done';

const MAX_ROWS = 200;
const TEXT_LIMIT = 80;

// `sentToTracker` is copied as parsed, so the panel can count comments sent to a tracker.
export type InboxRow = Pick<
  InboxFile,
  | 'id'
  | 'batchId'
  | 'status'
  | 'iteration'
  | 'route'
  | 'selector'
  | 'comment'
  | 'createdAt'
  | 'iterations'
  | 'file'
  | 'orphaned'
  | 'parked'
  | 'sentToTracker'
> & { target?: { tag: string; text: string } };

function toRow(f: InboxFile): InboxRow {
  return {
    id: f.id,
    batchId: f.batchId,
    status: f.status,
    iteration: f.iteration,
    route: f.route,
    selector: f.selector,
    comment: f.comment,
    createdAt: f.createdAt,
    iterations: f.iterations,
    ...(f.file !== undefined ? { file: f.file } : {}),
    ...(f.orphaned !== undefined ? { orphaned: f.orphaned } : {}),
    ...(f.parked !== undefined ? { parked: f.parked } : {}),
    ...(f.sentToTracker !== undefined ? { sentToTracker: f.sentToTracker } : {}),
  };
}

function time(row: InboxRow): number {
  const t = Date.parse(row.createdAt);
  return Number.isNaN(t) ? 0 : t;
}

async function readTarget(inboxDir: string, id: string): Promise<InboxRow['target']> {
  try {
    const raw = await readFile(path.join(inboxDir, id, 'payload.json'), 'utf8');
    const element = Element.safeParse(JSON.parse(raw).element);
    if (!element.success) return undefined;
    const text = element.data.text.replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMIT);
    return { tag: element.data.tag, text };
  } catch {
    return undefined;
  }
}

async function readRows(inboxDir: string): Promise<InboxRow[]> {
  const names = (await readdir(inboxDir)).filter((n) => n.endsWith('.md'));
  const rows = await Promise.all(
    names.map(async (name) => {
      try {
        return toRow(parse(await readFile(path.join(inboxDir, name), 'utf8')));
      } catch {
        return undefined;
      }
    }),
  );
  return rows.filter((r): r is InboxRow => r !== undefined);
}

/** Lists `<passbackDir>/inbox/*.md` as panel rows, newest first, at most 200. `truncated` is true
 * when more files parsed than were returned. First moves comments accepted 24 hours before `now`
 * to `done/` (archiveDone); writes nothing else; never throws or rejects. */
export async function listInbox(
  passbackDir: string,
  now?: Date,
): Promise<{ items: InboxRow[]; truncated: boolean }> {
  try {
    await archiveDone(passbackDir, now);
    const inboxDir = path.join(passbackDir, 'inbox');
    const rows = await readRows(inboxDir);
    rows.sort((a, b) => time(b) - time(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    const items = await Promise.all(
      rows.slice(0, MAX_ROWS).map(async (row) => {
        const target = await readTarget(inboxDir, row.id);
        return target ? { ...row, target } : row;
      }),
    );
    return { items, truncated: rows.length > MAX_ROWS };
  } catch {
    return { items: [], truncated: false };
  }
}
