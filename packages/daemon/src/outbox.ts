// writeStatus is the core of passback_status. It validates a status event
// against ChannelStatus and writes it atomically, so the plugin never reads a half-written file.

import { link, mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChannelStatus, type MarkState } from '@passback/schema';
import type { Clock } from './core/clock';
import { systemClock } from './adapters/system-clock';

export type StatusInput = {
  markId: string;
  state: MarkState;
  message?: string;
  prUrl?: string;
};

export type WriteStatusOptions = {
  outboxDir: string;
  now?: () => Date;
  clock?: Clock;
};

function fileStem(event: ChannelStatus): string {
  return `${event.at.replace(/[:.]/g, '-')}-${event.markId}-${event.state}`;
}

function candidateName(stem: string, n: number): string {
  return n === 1 ? `${stem}.json` : `${stem}-${n}.json`;
}

/** Links `tmp` to the first `<stem>.json`, `<stem>-2.json`, … not already in `dir`, "free"
 * decided atomically by `link`'s `EEXIST`, never by a check beforehand. Returns the published
 * absolute path. */
async function publish(dir: string, stem: string, tmp: string): Promise<string> {
  for (let n = 1; ; n += 1) {
    const candidate = path.resolve(dir, candidateName(stem, n));
    try {
      await link(tmp, candidate);
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

/** Validates `input` against `ChannelStatus` and writes it to `opts.outboxDir`, so a reader
 * never sees a half-written file. Throws a `ZodError` (writing nothing) when `input` does not
 * match the channel contract. */
export async function writeStatus(input: StatusInput, opts: WriteStatusOptions): Promise<string> {
  const clock = opts.clock ?? systemClock;
  const now = opts.now ?? ((): Date => new Date(clock.now()));
  const event = ChannelStatus.parse({
    v: 1,
    markId: input.markId,
    state: input.state,
    ...(input.message !== undefined ? { message: input.message } : {}),
    ...(input.prUrl !== undefined ? { prUrl: input.prUrl } : {}),
    at: now().toISOString(),
  });

  await mkdir(opts.outboxDir, { recursive: true });
  const stem = fileStem(event);
  const tmp = path.join(opts.outboxDir, `${stem}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(event)}\n`, { flag: 'wx' });
    return await publish(opts.outboxDir, stem, tmp);
  } finally {
    try {
      await unlink(tmp);
    } catch {
      // best-effort: a successful publish already linked the event, and a write/publish
      // failure must reject with its own error, not a subsequent cleanup error.
    }
  }
}
