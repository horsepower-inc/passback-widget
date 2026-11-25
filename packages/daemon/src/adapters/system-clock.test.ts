import { describe, expect, it } from 'vitest';
import { systemClock } from './system-clock';

describe('systemClock', () => {
  it('now tracks Date.now', () => {
    expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(5);
  });

  it('setTimer fires its callback after the delay', async () => {
    const start = Date.now();
    await new Promise<void>((resolve) => {
      systemClock.setTimer(20, resolve);
    });
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it('the cancel function stops a timer from firing', async () => {
    let fired = false;
    const cancel = systemClock.setTimer(10, () => {
      fired = true;
    });
    cancel();

    await new Promise<void>((resolve) => {
      systemClock.setTimer(20, resolve);
    });
    expect(fired).toBe(false);
  });

  it('sleep resolves after the delay', async () => {
    const start = Date.now();
    await systemClock.sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});
