import { describe, expect, it } from 'vitest';
import { withScope, type Effect } from './scope';

const effectOf = (release: Effect['release']): Effect => ({ release });

describe('withScope', () => {
  it('acquire returns the effect it was given', async () => {
    const effect = effectOf(() => undefined);
    await withScope((scope) => {
      expect(scope.acquire(effect)).toBe(effect);
    });
  });

  it('releases acquired effects in reverse order', async () => {
    const order: string[] = [];
    await withScope((scope) => {
      scope.acquire(
        effectOf(() => {
          order.push('a');
        }),
      );
      scope.acquire(
        effectOf(() => {
          order.push('b');
        }),
      );
      scope.acquire(
        effectOf(() => {
          order.push('c');
        }),
      );
    });
    expect(order).toEqual(['c', 'b', 'a']);
  });

  it('resolves to the body value after releasing', async () => {
    const order: string[] = [];
    const result = await withScope((scope) => {
      scope.acquire(
        effectOf(() => {
          order.push('released');
        }),
      );
      return 'body value';
    });
    expect(order).toEqual(['released']);
    expect(result).toBe('body value');
  });

  it('awaits an async release before starting the next', async () => {
    const order: string[] = [];
    await withScope((scope) => {
      scope.acquire(
        effectOf(() => {
          order.push('second start');
        }),
      );
      scope.acquire(
        effectOf(() => {
          order.push('first start');
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              order.push('first end');
              resolve();
            }, 10);
          });
        }),
      );
    });
    expect(order).toEqual(['first start', 'first end', 'second start']);
  });

  it('releases every effect even when one release throws', async () => {
    const order: string[] = [];
    await withScope((scope) => {
      scope.acquire(
        effectOf(() => {
          order.push('a');
        }),
      );
      scope.acquire(
        effectOf(() => {
          order.push('b');
          throw new Error('release b failed');
        }),
      );
      scope.acquire(
        effectOf(() => {
          order.push('c');
        }),
      );
    }).catch(() => undefined);
    expect(order).toEqual(['c', 'b', 'a']);
  });

  it('rejects with the release failure itself when one release fails', async () => {
    const failure = new Error('release failed');
    const promise = withScope((scope) => {
      scope.acquire(effectOf(() => undefined));
      scope.acquire(
        effectOf(() => {
          throw failure;
        }),
      );
      return 'value';
    });
    await expect(promise).rejects.toBe(failure);
  });

  it('rejects with an AggregateError when several releases fail', async () => {
    const firstFailure = new Error('first release failed');
    const secondFailure = new Error('second release failed');
    const promise = withScope((scope) => {
      scope.acquire(
        effectOf(() => {
          throw firstFailure;
        }),
      );
      scope.acquire(
        effectOf(() => {
          throw secondFailure;
        }),
      );
      return 'value';
    });
    await expect(promise).rejects.toThrow(AggregateError);
    await promise.catch((error: unknown) => {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([secondFailure, firstFailure]);
    });
  });

  it('releases everything and rejects with the body error when the body throws', async () => {
    const order: string[] = [];
    const bodyError = new Error('body failed');
    const promise = withScope((scope) => {
      scope.acquire(
        effectOf(() => {
          order.push('a');
        }),
      );
      scope.acquire(
        effectOf(() => {
          order.push('b');
        }),
      );
      throw bodyError;
    });
    await expect(promise).rejects.toBe(bodyError);
    expect(order).toEqual(['b', 'a']);
  });

  it('a release failure never replaces a body failure', async () => {
    const bodyError = new Error('body failed');
    const releaseError = new Error('release failed');
    const promise = withScope((scope) => {
      scope.acquire(
        effectOf(() => {
          throw releaseError;
        }),
      );
      throw bodyError;
    });
    await expect(promise).rejects.toBe(bodyError);
  });
});
