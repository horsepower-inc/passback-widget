import { MAX_BATCH_MARKS } from '@passback/schema';

export const BATCH_WINDOW_MS = 2000;

export type MarkBatch = { seq: number; ids: string[] };

export type BatcherOptions = { windowMs?: number; maxMarks?: number };

type PendingMark = { id: string; at: number };

/** Clock-free batching queue: caller passes `now`, arms its own timer from `nextDueAt()`. */
export class MarkBatcher {
  private readonly windowMs: number;
  private readonly maxMarks: number;
  private readonly pending: PendingMark[] = [];
  private readonly inFlightBatches = new Map<number, string[]>();
  private nextSeq = 1;

  constructor(opts: BatcherOptions = {}) {
    this.windowMs = opts.windowMs ?? BATCH_WINDOW_MS;
    this.maxMarks = opts.maxMarks ?? MAX_BATCH_MARKS;
  }

  offer(id: string, now: number): boolean {
    if (this.pending.some((mark) => mark.id === id)) return false;
    for (const ids of this.inFlightBatches.values()) {
      if (ids.includes(id)) return false;
    }
    this.pending.push({ id, at: now });
    return true;
  }

  nextDueAt(): number | undefined {
    const first = this.pending[0];
    if (!first) return undefined;
    if (this.pending.length >= this.maxMarks) return first.at;
    return first.at + this.windowMs;
  }

  due(now: number): MarkBatch | undefined {
    const dueAt = this.nextDueAt();
    if (dueAt === undefined || dueAt > now) return undefined;

    const count = Math.min(this.pending.length, this.maxMarks);
    const closed = this.pending.splice(0, count);
    const ids = closed.map((mark) => mark.id);
    const seq = this.nextSeq++;
    this.inFlightBatches.set(seq, ids);
    return { seq, ids };
  }

  settle(seq: number): string[] {
    const ids = this.inFlightBatches.get(seq);
    if (!ids) return [];
    this.inFlightBatches.delete(seq);
    return ids;
  }

  inFlight(): MarkBatch[] {
    return [...this.inFlightBatches.entries()].map(([seq, ids]) => ({
      seq,
      ids: [...ids],
    }));
  }
}
