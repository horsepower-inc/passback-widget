import { describe, expect, it } from 'vitest';
import { FakeClock } from './fake-clock';

describe('FakeClock', () => {
  it('now returns the start time and does not move on its own', () => {
    const clock = new FakeClock(100);
    expect(clock.now()).toBe(100);
    expect(clock.now()).toBe(100);
  });

  it('advance fires due timers in due order and sets now to each due time', () => {
    const clock = new FakeClock();
    const fired: Array<{ label: string; now: number }> = [];
    clock.setTimer(300, () => fired.push({ label: 'c', now: clock.now() }));
    clock.setTimer(100, () => fired.push({ label: 'a', now: clock.now() }));
    clock.setTimer(200, () => fired.push({ label: 'b', now: clock.now() }));

    clock.advance(300);

    expect(fired).toEqual([
      { label: 'a', now: 100 },
      { label: 'b', now: 200 },
      { label: 'c', now: 300 },
    ]);
    expect(clock.now()).toBe(300);
  });

  it('timers due at the same time fire in the order they were set', () => {
    const clock = new FakeClock();
    const fired: string[] = [];
    clock.setTimer(100, () => fired.push('first'));
    clock.setTimer(100, () => fired.push('second'));

    clock.advance(100);

    expect(fired).toEqual(['first', 'second']);
  });

  it('a timer set during advance fires in the same advance when it falls due', () => {
    const clock = new FakeClock();
    const fired: string[] = [];
    clock.setTimer(100, () => {
      fired.push('first');
      clock.setTimer(50, () => fired.push('nested'));
    });

    clock.advance(200);

    expect(fired).toEqual(['first', 'nested']);
    expect(clock.now()).toBe(200);
  });

  it('a cancelled timer never fires', () => {
    const clock = new FakeClock();
    const fired: string[] = [];
    const cancel = clock.setTimer(100, () => fired.push('fired'));

    cancel();
    clock.advance(200);

    expect(fired).toEqual([]);
  });

  it('cancel twice or after firing is harmless', () => {
    const clock = new FakeClock();
    const fired: string[] = [];
    const cancelFired = clock.setTimer(100, () => fired.push('fired'));
    clock.advance(100);
    expect(fired).toEqual(['fired']);
    expect(() => {
      cancelFired();
    }).not.toThrow();

    const cancelPending = clock.setTimer(100, () => fired.push('never'));
    cancelPending();
    expect(() => {
      cancelPending();
    }).not.toThrow();
    clock.advance(200);
    expect(fired).toEqual(['fired']);
  });

  it('a negative delay is treated as zero', () => {
    const clock = new FakeClock(50);
    const fired: number[] = [];
    clock.setTimer(-10, () => fired.push(clock.now()));

    clock.advance(0);

    expect(fired).toEqual([50]);
  });

  it('sleep resolves once advance reaches its due time', async () => {
    const clock = new FakeClock();
    let resolved = false;
    void clock.sleep(100).then(() => {
      resolved = true;
    });

    clock.advance(99);
    expect(resolved).toBe(false);

    clock.advance(1);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('pending counts timers not yet fired', () => {
    const clock = new FakeClock();
    expect(clock.pending()).toBe(0);

    const cancel = clock.setTimer(100, () => {});
    clock.setTimer(200, () => {});
    expect(clock.pending()).toBe(2);

    cancel();
    expect(clock.pending()).toBe(1);

    clock.advance(200);
    expect(clock.pending()).toBe(0);
  });
});
