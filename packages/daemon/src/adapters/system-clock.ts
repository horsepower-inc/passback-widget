import type { Clock } from '../core/clock';

export const systemClock: Clock = {
  now(): number {
    return Date.now();
  },
  setTimer(ms: number, cb: () => void) {
    const handle = setTimeout(cb, Math.max(0, ms));
    return () => {
      clearTimeout(handle);
    };
  },
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, ms));
    });
  },
};
