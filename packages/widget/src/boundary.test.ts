// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createBoundary } from './boundary';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createBoundary', () => {
  it('passes arguments and the return value through while untripped', () => {
    const onTrip = vi.fn();
    const boundary = createBoundary(onTrip);
    const add = (a: number, b: number): number => a + b;
    const guarded = boundary.guard(add);

    expect(guarded(2, 3)).toBe(5);
    expect(onTrip).not.toHaveBeenCalled();
    expect(boundary.tripped()).toBe(false);
  });

  it('a throw trips the boundary and the call returns undefined', () => {
    const onTrip = vi.fn();
    const boundary = createBoundary(onTrip);
    const error = new Error('boom');
    const guarded = boundary.guard(() => {
      throw error;
    });

    expect(guarded()).toBeUndefined();
    expect(boundary.tripped()).toBe(true);
    expect(onTrip).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('calls onTrip once with the first error however many guarded functions fail', () => {
    const onTrip = vi.fn();
    const boundary = createBoundary(onTrip);
    const first = new Error('first');
    const second = new Error('second');
    const guardedFirst = boundary.guard(() => {
      throw first;
    });
    const guardedSecond = boundary.guard(() => {
      throw second;
    });

    expect(guardedFirst()).toBeUndefined();
    expect(guardedSecond()).toBeUndefined();
    expect(onTrip).toHaveBeenCalledExactlyOnceWith(first);
  });

  it('a tripped boundary calls no guarded function', () => {
    const onTrip = vi.fn();
    const boundary = createBoundary(onTrip);
    boundary.guard(() => {
      throw new Error('trip it');
    })();

    const untouched = vi.fn(() => 'value');
    const guarded = boundary.guard(untouched);

    expect(guarded()).toBeUndefined();
    expect(untouched).not.toHaveBeenCalled();
  });

  it('an async function that rejects trips the boundary and resolves undefined', async () => {
    const onTrip = vi.fn();
    const boundary = createBoundary(onTrip);
    const error = new Error('async boom');
    const guarded = boundary.guardAsync(async () => {
      throw error;
    });

    await expect(guarded()).resolves.toBeUndefined();
    expect(boundary.tripped()).toBe(true);
    expect(onTrip).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('an async function that throws before returning a promise trips the boundary', async () => {
    const onTrip = vi.fn();
    const boundary = createBoundary(onTrip);
    const error = new Error('sync throw in async wrapper');
    const guarded = boundary.guardAsync((): Promise<never> => {
      throw error;
    });

    await expect(guarded()).resolves.toBeUndefined();
    expect(boundary.tripped()).toBe(true);
    expect(onTrip).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('an async function that resolves passes its value through', async () => {
    const onTrip = vi.fn();
    const boundary = createBoundary(onTrip);
    const guarded = boundary.guardAsync(async (a: number, b: number) => a + b);

    await expect(guarded(2, 3)).resolves.toBe(5);
    expect(onTrip).not.toHaveBeenCalled();
    expect(boundary.tripped()).toBe(false);
  });

  it('a rejection that settles after the trip does not call onTrip again', async () => {
    const onTrip = vi.fn();
    const boundary = createBoundary(onTrip);
    const pending = deferred<number>();
    const slow = boundary.guardAsync(() => pending.promise);
    const slowCall = slow();

    boundary.guard(() => {
      throw new Error('trips first');
    })();

    pending.reject(new Error('settles late'));
    await expect(slowCall).resolves.toBeUndefined();
    expect(onTrip).toHaveBeenCalledTimes(1);
  });

  it('an onTrip that throws does not escape', () => {
    const boundary = createBoundary(() => {
      throw new Error('onTrip failed');
    });
    const guarded = boundary.guard(() => {
      throw new Error('original');
    });

    expect(() => guarded()).not.toThrow();
    expect(boundary.tripped()).toBe(true);
  });

  it('two boundaries trip independently', () => {
    const onTripA = vi.fn();
    const onTripB = vi.fn();
    const boundaryA = createBoundary(onTripA);
    const boundaryB = createBoundary(onTripB);

    boundaryA.guard(() => {
      throw new Error('only A trips');
    })();

    expect(boundaryA.tripped()).toBe(true);
    expect(boundaryB.tripped()).toBe(false);
    expect(onTripB).not.toHaveBeenCalled();
  });

  it('a guarded event listener that throws does not make dispatchEvent throw', () => {
    const onTrip = vi.fn();
    const boundary = createBoundary(onTrip);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.addEventListener(
      'click',
      boundary.guard(() => {
        throw new Error('listener failed');
      }),
    );

    expect(() => button.dispatchEvent(new MouseEvent('click'))).not.toThrow();
    expect(onTrip).toHaveBeenCalledOnce();
  });
});
