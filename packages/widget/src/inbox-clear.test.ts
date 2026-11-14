import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hot } from './channel';
import { CLEAR_WAIT_MS, clearCounts, clearOf, createClearPort } from './inbox-clear';

function fakeHot() {
  const handlers: ((data: unknown) => void)[] = [];
  const hot = {
    send: vi.fn(),
    on: vi.fn((_event: string, cb: (data: unknown) => void) => void handlers.push(cb)),
    off: vi.fn((_event: string, cb: (data: unknown) => void) => {
      const i = handlers.indexOf(cb);
      if (i >= 0) handlers.splice(i, 1);
    }),
  };
  return {
    hot: hot as unknown as Hot & typeof hot,
    handlers,
    emit: (d: unknown) => [...handlers].forEach((h) => h(d)),
  };
}

const answer = (scope: string, extra: object = {}) => ({
  v: 1,
  scope,
  comments: 2,
  attachments: 1,
  answers: 0,
  done: 3,
  settings: false,
  ...extra,
});

describe('inbox clear port', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts the fixed, tracker, working and all rows by the adapter rules', () => {
    const rows = [
      { status: 'accepted' },
      { status: 'verified', sentToTracker: { id: 1 } },
      { status: 'ack' },
      { status: 'proposed', sentToTracker: null },
      { status: 'queued' },
    ];
    expect(clearCounts(rows)).toEqual({ comments: 5, fixed: 2, tracker: 2, working: 1 });
    expect(clearCounts([])).toEqual({ comments: 0, fixed: 0, tracker: 0, working: 0 });
  });

  it('has no port without a channel or without the clear capability', () => {
    const { hot } = fakeHot();
    expect(createClearPort({ hot: undefined, caps: ['clear'] })).toBeUndefined();
    expect(createClearPort({ hot, caps: ['reopen'] })).toBeUndefined();
    expect(createClearPort({ hot, caps: undefined })).toBeUndefined();
    expect(createClearPort({ hot, caps: ['clear'] })).toBeDefined();
    const win = { __passback: { hot, caps: ['clear'] } } as unknown as Window;
    expect(clearOf(win)).toBeDefined();
    expect(clearOf({} as Window)).toBeUndefined();
  });

  it('sends the request and resolves with the answer of the same scope', async () => {
    const { hot, emit, handlers } = fakeHot();
    const port = createClearPort({ hot, caps: ['clear'] });
    const result = port?.send({ v: 1, scope: 'fixed' });
    expect(hot.send).toHaveBeenCalledWith('passback:clear', { v: 1, scope: 'fixed' });
    emit(answer('workspace'));
    emit(answer('fixed'));
    await expect(result).resolves.toEqual(answer('fixed'));
    expect(handlers).toHaveLength(0);
    expect(hot.off).toHaveBeenCalledWith('passback:cleared', expect.any(Function));
  });

  it('resolves undefined after the wait, on a malformed answer and when the channel throws', async () => {
    const { hot, emit } = fakeHot();
    const port = createClearPort({ hot, caps: ['clear'] });
    const slow = port?.send({ v: 1, scope: 'tracker' });
    emit(answer('tracker', { v: 2 }));
    emit(answer('tracker', { comments: -1 }));
    emit(answer('tracker', { done: 1.5 }));
    emit(null);
    vi.advanceTimersByTime(CLEAR_WAIT_MS);
    await expect(slow).resolves.toBeUndefined();

    hot.send.mockImplementationOnce(() => {
      throw new Error('closed');
    });
    await expect(port?.send({ v: 1, scope: 'fixed' })).resolves.toBeUndefined();
    hot.on.mockImplementationOnce(() => {
      throw new Error('closed');
    });
    await expect(port?.send({ v: 1, scope: 'fixed' })).resolves.toBeUndefined();
  });

  it('replaces a request in flight with a newer one', async () => {
    const { hot, emit } = fakeHot();
    const port = createClearPort({ hot, caps: ['clear'] });
    const first = port?.send({ v: 1, scope: 'fixed' });
    const second = port?.send({ v: 1, scope: 'fixed' });
    await expect(first).resolves.toBeUndefined();
    emit(answer('fixed'));
    await expect(second).resolves.toMatchObject({ scope: 'fixed', comments: 2 });
    const third = port?.send({ v: 1, scope: 'fixed' });
    port?.cancel();
    await expect(third).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
