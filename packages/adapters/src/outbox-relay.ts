// the plugin's half of the outbox — hand each `.passback/outbox/` file
// to `send` unchanged, delete it after, and move an unparsable one aside. No fs.watch, same
// polling style as status-watch.ts.

import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, render, type Iteration } from '@passback/inbox';
import { ChannelStatus } from '@passback/schema';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type IterationStatus = NonNullable<Iteration['statuses']>[number];

function sameStatus(a: IterationStatus, b: IterationStatus): boolean {
  return a.state === b.state && a.message === b.message && a.prUrl === b.prUrl;
}

/** Appends the event to the `statuses` of the inbox file's current iteration, skipping a repeat of
 * the last entry (a retry after a failed send, a repeated reopen). The file is written to a
 * temporary name and renamed over the target. A mark without an inbox file is left alone. */
async function saveStatus(dir: string, event: ChannelStatus): Promise<void> {
  const target = path.join(path.dirname(dir), 'inbox', `${event.markId}.md`);
  let text: string;
  try {
    text = await readFile(target, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  const file = parse(text);
  const entry: IterationStatus = {
    state: event.state,
    at: event.at,
    ...(event.message !== undefined ? { message: event.message } : {}),
    ...(event.prUrl !== undefined ? { prUrl: event.prUrl } : {}),
  };
  const current = file.iterations.find((it) => it.n === file.iteration);
  const last = current?.statuses?.at(-1);
  if (last && sameStatus(last, entry)) return;

  const iterations: Iteration[] = current
    ? file.iterations.map((it) =>
        it.n === file.iteration ? { ...it, statuses: [...(it.statuses ?? []), entry] } : it,
      )
    : [...file.iterations, { n: file.iteration, statuses: [entry] }];
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, render({ ...file, iterations }));
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

type DrainHooks = {
  send: (event: ChannelStatus) => void;
  log: (message: string) => void;
  shouldContinue: () => boolean;
};

async function drainFile(
  dir: string,
  name: string,
  { send, log, shouldContinue }: DrainHooks,
): Promise<'sent' | 'kept' | 'stopped'> {
  const file = path.join(dir, name);
  const text = await readFile(file, 'utf8');
  if (!shouldContinue()) return 'stopped';

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    log(`outbox: ${name}: not valid JSON (${errorMessage(err)})`);
    await rename(file, `${file}.bad`);
    return 'kept';
  }

  const result = ChannelStatus.safeParse(raw);
  if (!result.success) {
    log(`outbox: ${name}: does not match ChannelStatus (${result.error.message})`);
    await rename(file, `${file}.bad`);
    return 'kept';
  }

  try {
    await saveStatus(dir, result.data);
  } catch (err) {
    log(`outbox: ${name}: cannot save status in the inbox (${errorMessage(err)})`);
    return 'kept';
  }

  try {
    send(raw as ChannelStatus);
  } catch (err) {
    log(`outbox: ${name}: send failed (${errorMessage(err)})`);
    return 'kept';
  }

  await unlink(file);
  return 'sent';
}

/** Hands every `.json` file in `dir`, oldest name first, to `send` and deletes it after. A file
 * that is not JSON or fails `ChannelStatus` is logged once and renamed to `<name>.bad`, not sent.
 * A `send` that throws is logged once and the file is left for the next drain. Filesystem
 * errors reject. `shouldContinue` is checked for each file after it is read and before it is
 * parsed and sent; once it returns false that file is left untouched and the drain returns. Returns how many
 * events were sent. */
export async function drainOutbox(
  dir: string,
  send: (event: ChannelStatus) => void,
  log: (message: string) => void = (): void => {},
  shouldContinue: () => boolean = () => true,
): Promise<number> {
  await mkdir(dir, { recursive: true });
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();

  let sent = 0;
  for (const name of names) {
    const outcome = await drainFile(dir, name, { send, log, shouldContinue });
    if (outcome === 'stopped') break;
    if (outcome === 'sent') sent += 1;
  }
  return sent;
}

export type StartOutboxRelayOptions = {
  pollMs?: number;
  log?: (message: string) => void;
};

/** Runs `drainOutbox` at once and then every `pollMs` (default 250), never overlapping two
 * drains; a rejected drain is logged and retried on the next tick. Returns a stop function that
 * clears the timer and stops any in-flight drain at the next file boundary; calling it twice is
 * harmless. */
export function startOutboxRelay(
  dir: string,
  send: (event: ChannelStatus) => void,
  opts: StartOutboxRelayOptions = {},
): () => void {
  const pollMs = opts.pollMs ?? 250;
  const log = opts.log ?? ((): void => {});
  let draining = false;
  let stopped = false;

  const tick = (): void => {
    if (stopped || draining) return;
    draining = true;
    drainOutbox(dir, send, log, () => !stopped)
      .catch((err: unknown) => log(`outbox: drain failed (${errorMessage(err)})`))
      .finally(() => {
        draining = false;
      });
  };

  tick();
  const timer = setInterval(tick, pollMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
