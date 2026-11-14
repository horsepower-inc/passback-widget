// TrackerAdapter over the local .passback/inbox filesystem format (§2).

import { constants, existsSync } from 'node:fs';
import { copyFile, link, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fromPayload, render } from '@passback/inbox';
import { redact } from '@passback/schema';
import type { Batch, Payload } from '@passback/schema';
import { readStatus, watchStatus } from './status-watch';
import { ulid } from './ulid';
import type { Attachment, Ref, TrackerAdapter, Unsubscribe } from './tracker-adapter';

export type FileInboxOptions = {
  root?: string;
  pollMs?: number;
  newId?: () => string;
  now?: () => Date;
};

/** A non-empty name with no path separators that is not `.` or `..`. */
function isPlainName(name: string): boolean {
  return (
    name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\')
  );
}

/** Writes a sibling temp file and hard-links it into place, so a reader never sees a
 * half-written file under `target` and an existing `target` is never replaced. */
async function writeNewFileAtomically(target: string, text: string): Promise<void> {
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, text, { flag: 'wx' });
    await link(tmp, target);
  } finally {
    await rm(tmp, { force: true });
  }
}

export class FileInboxAdapter implements TrackerAdapter {
  private readonly root: string;
  private readonly pollMs: number;
  private readonly newId: () => string;
  private readonly now: () => Date;

  constructor(opts: FileInboxOptions = {}) {
    this.root = path.resolve(opts.root ?? '.passback/inbox');
    this.pollMs = opts.pollMs ?? 250;
    this.newId = opts.newId ?? ulid;
    this.now = opts.now ?? (() => new Date());
  }

  private issuePath(id: string): string {
    return path.join(this.root, `${id}.md`);
  }

  async createParent(batch: Batch): Promise<Ref> {
    if (batch.marks.length < 2) throw new Error('a batch of one never creates a parent');
    return { id: batch.id };
  }

  async createIssue(payload: Payload, opts?: { parent?: Ref }): Promise<Ref> {
    const id = this.newId();
    if (!isPlainName(id)) throw new Error(`invalid new id: ${id}`);
    const batchId = opts?.parent?.id ?? id;
    const createdAt = this.now().toISOString();
    const clean = redact(payload);
    await mkdir(path.join(this.root, id), { recursive: true });
    await writeNewFileAtomically(
      path.join(this.root, id, 'payload.json'),
      `${JSON.stringify(clean, null, 2)}\n`,
    );
    const file = fromPayload(clean, { id, batchId, createdAt });
    await writeNewFileAtomically(this.issuePath(id), render(file));
    return { id };
  }

  async attach(ref: Ref, file: Attachment): Promise<void> {
    if (!isPlainName(ref.id)) throw new Error(`invalid ref id: ${ref.id}`);
    if (!isPlainName(file.name)) throw new Error(`invalid attachment name: ${file.name}`);
    if (!existsSync(this.issuePath(ref.id))) throw new Error(`no inbox file for ${ref.id}`);
    const dir = path.join(this.root, ref.id);
    await mkdir(dir, { recursive: true });
    await copyFile(file.path, path.join(dir, file.name), constants.COPYFILE_EXCL);
  }

  onStatusChange(ref: Ref, cb: (status: string) => void): Unsubscribe {
    if (!isPlainName(ref.id)) throw new Error(`invalid ref id: ${ref.id}`);
    const issuePath = this.issuePath(ref.id);
    if (!existsSync(issuePath)) throw new Error(`no inbox file for ${ref.id}`);
    return watchStatus(issuePath, this.pollMs, cb);
  }

  async getStatus(ref: Ref): Promise<string> {
    if (!isPlainName(ref.id)) throw new Error(`invalid ref id: ${ref.id}`);
    const issuePath = this.issuePath(ref.id);
    if (!existsSync(issuePath)) throw new Error(`no inbox file for ${ref.id}`);
    const status = readStatus(issuePath);
    if (status === undefined) throw new Error(`no readable status for ${ref.id}`);
    return status;
  }
}
