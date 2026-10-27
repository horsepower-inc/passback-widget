import type { CancelTimer, Clock } from './clock';

interface PendingTimer {
  readonly dueAt: number;
  readonly seq: number;
  readonly cb: () => void;
}

export class FakeClock implements Clock {
  private currentTime: number;
  private nextSeq = 0;
  private timers: PendingTimer[] = [];

  constructor(start = 0) {
    this.currentTime = start;
  }

  now(): number {
    return this.currentTime;
  }

  setTimer(ms: number, cb: () => void): CancelTimer {
    const timer: PendingTimer = {
      dueAt: this.currentTime + Math.max(0, ms),
      seq: this.nextSeq++,
      cb,
    };
    this.timers.push(timer);
    return () => {
      const index = this.timers.indexOf(timer);
      if (index !== -1) {
        this.timers.splice(index, 1);
      }
    };
  }

  advance(ms: number): void {
    const target = this.currentTime + Math.max(0, ms);
    for (;;) {
      const next = this.dueTimer(target);
      if (!next) {
        break;
      }
      const index = this.timers.indexOf(next);
      this.timers.splice(index, 1);
      this.currentTime = next.dueAt;
      next.cb();
    }
    this.currentTime = target;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.setTimer(ms, resolve);
    });
  }

  pending(): number {
    return this.timers.length;
  }

  private dueTimer(target: number): PendingTimer | undefined {
    let best: PendingTimer | undefined;
    for (const timer of this.timers) {
      if (timer.dueAt > target) {
        continue;
      }
      if (
        !best ||
        timer.dueAt < best.dueAt ||
        (timer.dueAt === best.dueAt && timer.seq < best.seq)
      ) {
        best = timer;
      }
    }
    return best;
  }
}
