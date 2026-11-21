// Comments this process handed to the agent, so a later `withdrawn` status can be reported once
// on the next passback_wait. In memory only: a restart forgets them.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@passback/inbox';

/** Per inbox directory, ids handed to the agent and not yet finished or reported as withdrawn. */
const remembered = new Map<string, Set<string>>();

/** Adds `ids` to the comments `root` is remembering as handed over to the agent. */
export function rememberHandedOver(root: string, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const set = remembered.get(root) ?? new Set<string>();
  for (const id of ids) set.add(id);
  remembered.set(root, set);
}

/** Ids handed over that were withdrawn before the agent replied, sorted ascending; each is forgotten
 * once returned. A missing or unparsable file, or one with an agent reply on its current iteration,
 * is forgotten without being reported. Never throws. */
export async function takeWithdrawn(root: string): Promise<string[]> {
  const set = remembered.get(root);
  if (set === undefined) return [];
  const withdrawn: string[] = [];
  for (const id of [...set]) {
    try {
      const file = parse(await readFile(path.join(root, `${id}.md`), 'utf8'));
      const current = file.iterations.find((it) => it.n === file.iteration);
      if (current?.agent !== undefined) {
        set.delete(id);
      } else if (file.status === 'withdrawn') {
        set.delete(id);
        withdrawn.push(id);
      }
    } catch {
      set.delete(id);
    }
  }
  if (set.size === 0) remembered.delete(root);
  return withdrawn.sort();
}
