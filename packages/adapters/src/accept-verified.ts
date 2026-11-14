// The HMR surface for passback:verified: move the named `proposed` inbox
// files to `verified`, without ever throwing back into the caller. The plugin cannot reach the
// daemon's verifyMark (filesystem IPC only), so this mirrors its rule.

import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, render, transition } from '@passback/inbox';
import { ChannelVerified } from '@passback/schema';

async function verifyOne(root: string, id: string): Promise<boolean> {
  const target = path.join(root, `${id}.md`);
  const file = parse(await readFile(target, 'utf8'));
  if (file.status !== 'proposed') return false;
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, render({ ...file, status: transition('proposed', 'verified', 'widget') }), {
    flag: 'wx',
  });
  await rename(tmp, target);
  return true;
}

/** Turns an unknown `passback:verified` payload into `status: verified` on the `proposed` inbox
 * files under `root` (`<project>/.passback/inbox`). Returns the ids actually moved, in message
 * order. Never throws or rejects; a failing id is skipped. */
export async function acceptVerified(root: string, input: unknown): Promise<string[]> {
  let parsed: ReturnType<typeof ChannelVerified.safeParse>;
  try {
    parsed = ChannelVerified.safeParse(input);
  } catch {
    return [];
  }
  if (!parsed.success) return [];

  const moved: string[] = [];
  for (const id of parsed.data.markIds) {
    try {
      if (await verifyOne(root, id)) moved.push(id);
    } catch {
      // missing, unparseable or unwritable: skip this id, keep going
    }
  }
  return moved;
}
