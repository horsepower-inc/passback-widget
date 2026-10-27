// Local-mode screenshots: lands a stashed picture as `<inbox>/<id>/screenshot.png` before the
// mark's `<id>.md` becomes visible, so the daemon's poll never returns a mark without its picture.

import { randomBytes } from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileInboxAdapter } from '@passback/adapters/local';
import type { Ref } from '@passback/adapters/local';
import type { Payload } from '@passback/schema';
import type { ShotStash } from './shot-local';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID: 10 Crockford base32 chars of the millisecond time, then 16 of 80 random bits. */
function newUlid(time: number = Date.now()): string {
  let head = '';
  let rest = time;
  for (let i = 0; i < 10; i++) {
    head = ALPHABET[rest % 32]! + head;
    rest = Math.floor(rest / 32);
  }
  let bits = '';
  for (const byte of randomBytes(10)) bits += byte.toString(2).padStart(8, '0');
  let tail = '';
  for (let i = 0; i < 16; i++) tail += ALPHABET[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  return head + tail;
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

/** A {@link FileInboxAdapter} that writes the stashed picture a mark names before filing the mark.
 * It extends the adapter so `acceptMark` still hands a batch of one its batch id (CONTRACTS §2). */
export class ShotInboxAdapter extends FileInboxAdapter {
  private readonly inbox: string;
  private readonly claimed = new Set<string>();

  constructor(
    root: string,
    private readonly stash: ShotStash,
  ) {
    super({ root });
    this.inbox = path.resolve(root);
  }

  override async createIssue(payload: Payload, opts?: { parent?: Ref }): Promise<Ref> {
    const shot = payload.screenshot;
    const shotId = shot?.mime === 'image/png' && !this.claimed.has(shot.id) ? shot.id : undefined;
    const bytes = shotId === undefined ? undefined : this.stash.peek(shotId);
    if (shotId === undefined || bytes === undefined) return super.createIssue(payload, opts);
    // Claimed while writing so a second mark naming the same picture is filed without it; the
    // stash entry is only removed once both writes succeed, so a failed send can be retried.
    this.claimed.add(shotId);
    const id = newUlid();
    const dir = path.join(this.inbox, id);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'screenshot.png'), bytes, { flag: 'wx' });
      const ref = await new FileInboxAdapter({ root: this.inbox, newId: () => id }).createIssue(
        payload,
        opts,
      );
      this.stash.take(shotId);
      return ref;
    } catch (err) {
      // The adapter can reject after `<id>.md` is linked into place (removing its temp file
      // failed). The mark is then published with its picture: keep both and report it filed,
      // so the daemon never sees it without the png and a retry does not file it twice.
      if (await exists(path.join(this.inbox, `${id}.md`))) {
        this.stash.take(shotId);
        return { id };
      }
      // `<id>.md` was never published, so the directory is ours alone.
      await rm(dir, { recursive: true, force: true });
      throw err;
    } finally {
      this.claimed.delete(shotId);
    }
  }
}
