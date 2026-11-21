// The HMR surface for passback:orphaned: flag the named inbox files
// `orphaned: true`, status unchanged, without ever throwing back into the caller. The plugin
// cannot reach the daemon's orphanMark (filesystem IPC only), so this mirrors its rule.

import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, render } from '@passback/inbox';
import { ChannelOrphaned } from '@passback/schema';

const OPEN_STATUSES: readonly string[] = ['new', 'ack', 'proposed', 'verified'];

async function orphanOne(root: string, id: string): Promise<boolean> {
  const target = path.join(root, `${id}.md`);
  const file = parse(await readFile(target, 'utf8'));
  if (file.orphaned === true || !OPEN_STATUSES.includes(file.status)) return false;
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, render({ ...file, orphaned: true }), { flag: 'wx' });
  await rename(tmp, target);
  return true;
}

/** Turns an unknown `passback:orphaned` payload into `orphaned: true` on the open inbox files
 * under `root` (`<project>/.passback/inbox`). Returns the ids actually flagged, in message order.
 * Never throws or rejects; a failing id is skipped. */
export async function acceptOrphaned(root: string, input: unknown): Promise<string[]> {
  let parsed: ReturnType<typeof ChannelOrphaned.safeParse>;
  try {
    parsed = ChannelOrphaned.safeParse(input);
  } catch {
    return [];
  }
  if (!parsed.success) return [];

  const flagged: string[] = [];
  for (const id of parsed.data.markIds) {
    try {
      if (await orphanOne(root, id)) flagged.push(id);
    } catch {
      // missing, unparseable or unwritable: skip this id, keep going
    }
  }
  return flagged;
}
