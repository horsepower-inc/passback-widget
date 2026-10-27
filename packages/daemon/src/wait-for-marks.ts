// waitForMarks is the core of passback_wait; it never speaks MCP itself.

import type { InboxFile } from '@passback/inbox';
import { MAX_BATCH_MARKS } from '@passback/schema';
import { systemClock } from './adapters/system-clock';
import type { CancelTimer, Clock } from './core/clock';
import { ackMark, listNeedingAgent, reopenedFeedback } from './inbox-store';
import { rememberHandedOver } from './withdrawn';

export type WaitOptions = {
  root: string;
  timeoutMs: number;
  pollMs?: number;
  signal?: AbortSignal;
  clock?: Clock;
};

type Waiter = {
  root: string;
  pollMs: number;
  signal?: AbortSignal;
  clock: Clock;
  resolve: (marks: InboxFile[]) => void;
  reject: (err: unknown) => void;
};

type State = {
  settled: boolean;
  isPolling: boolean;
  timedOut: boolean;
  aborted: boolean;
  pollTimer?: CancelTimer;
  timeoutTimer?: CancelTimer;
};

/** Per root, keys `<id>|<iteration>` of reopened marks already returned by this process. */
const handedOver = new Map<string, Set<string>>();

function handoverKey(mark: InboxFile): string {
  return `${mark.id}|${mark.iteration}`;
}

/** Number of reopened iterations `root` is remembering as handed over (0 when none). */
export function handedOverCount(root: string): number {
  return handedOver.get(root)?.size ?? 0;
}

/** Keeps only the keys of marks still waiting as reopened candidates at the same iteration. */
function pruneHandedOver(root: string, marks: InboxFile[]): void {
  const seen = handedOver.get(root);
  if (seen === undefined) return;
  const waiting = new Set(
    marks.filter((mark) => reopenedFeedback(mark) !== undefined).map(handoverKey),
  );
  for (const key of seen) if (!waiting.has(key)) seen.delete(key);
  if (seen.size === 0) handedOver.delete(root);
}

/** One poll: lists candidates, acks up to MAX_BATCH_MARKS `new` ones in id order, returns what actually
 * got acked, plus reopened marks not yet handed over (those are not written). Stops (without acking further marks) once `isSettled` reports the call has timed out or
 * been aborted. An `ackMark` rejection after this poll has already acked a mark stops the loop and
 * returns what it has; a rejection before any mark is acked propagates so the caller rejects. */
async function pollOnce(root: string, isSettled: () => boolean): Promise<InboxFile[]> {
  const marks = await listNeedingAgent(root);
  pruneHandedOver(root, marks);
  const candidates = marks
    .filter(
      (mark) =>
        mark.status === 'new' ||
        (reopenedFeedback(mark) !== undefined && !handedOver.get(root)?.has(handoverKey(mark))),
    )
    .slice(0, MAX_BATCH_MARKS);
  const acked: InboxFile[] = [];
  for (const mark of candidates) {
    if (isSettled()) break;
    if (mark.status !== 'new') {
      const seen = handedOver.get(root) ?? new Set<string>();
      seen.add(handoverKey(mark));
      handedOver.set(root, seen);
      acked.push(mark);
      continue;
    }
    let written: InboxFile | undefined;
    try {
      written = await ackMark(root, mark.id);
    } catch (err) {
      if (acked.length > 0) break;
      throw err;
    }
    if (written) acked.push(written);
  }
  rememberHandedOver(
    root,
    acked.map((mark) => mark.id),
  );
  return acked;
}

/** Settles the wait at most once: clears both timers, drops the abort listener, then runs `settle`. */
function finish(w: Waiter, s: State, onAbort: () => void, settle: () => void): void {
  if (s.settled) return;
  s.settled = true;
  if (s.pollTimer !== undefined) s.pollTimer();
  if (s.timeoutTimer !== undefined) s.timeoutTimer();
  w.signal?.removeEventListener('abort', onAbort);
  settle();
}

function onPollSettled(w: Waiter, s: State, onAbort: () => void, acked: InboxFile[]): void {
  s.isPolling = false;
  if (s.settled) return;
  if (acked.length > 0) {
    finish(w, s, onAbort, () => w.resolve(acked));
  } else if (s.timedOut || s.aborted) {
    finish(w, s, onAbort, () => w.resolve([]));
  } else {
    s.pollTimer = w.clock.setTimer(w.pollMs, () => schedulePoll(w, s, onAbort));
  }
}

function schedulePoll(w: Waiter, s: State, onAbort: () => void): void {
  s.isPolling = true;
  pollOnce(w.root, () => s.settled || s.aborted).then(
    (acked) => onPollSettled(w, s, onAbort, acked),
    (err: unknown) => finish(w, s, onAbort, () => w.reject(err)),
  );
}

/** Long-polls `root` for `new` marks, acking each one it hands back. Resolves `[]` at `timeoutMs`, or
 * on abort, once no poll is running; a poll already in flight when the abort or timeout lands makes no
 * further `ackMark` calls but still resolves with whatever it already acked. */
export function waitForMarks(opts: WaitOptions): Promise<InboxFile[]> {
  const { root, timeoutMs, signal } = opts;
  const pollMs = opts.pollMs ?? 100;
  const clock = opts.clock ?? systemClock;

  return new Promise<InboxFile[]>((resolve, reject) => {
    if (signal?.aborted) {
      resolve([]);
      return;
    }

    const w: Waiter = { root, pollMs, signal, clock, resolve, reject };
    const s: State = { settled: false, isPolling: false, timedOut: false, aborted: false };
    const onAbort = (): void => {
      s.aborted = true;
      if (!s.isPolling) finish(w, s, onAbort, () => resolve([]));
    };

    s.timeoutTimer = clock.setTimer(timeoutMs, () => {
      s.timedOut = true;
      if (!s.isPolling) finish(w, s, onAbort, () => resolve([]));
    });

    signal?.addEventListener('abort', onAbort);
    schedulePoll(w, s, onAbort);
  });
}
