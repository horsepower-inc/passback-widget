import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hot } from './channel';
import { createReopen, reopenOf } from './reopen';

type Listener = (data: unknown) => void;

function fakeHot(sendImpl?: () => void) {
  const listeners = new Set<Listener>();
  const hot = {
    send: vi.fn<Hot['send']>(() => sendImpl?.()),
    on: vi.fn((_event: string, cb: Listener) => {
      listeners.add(cb);
    }),
    off: vi.fn((_event: string, cb: Listener) => {
      listeners.delete(cb);
    }),
  };
  const emit = (data: unknown): void => {
    for (const cb of [...listeners]) cb(data);
  };
  return { hot: hot as Hot & typeof hot, emit, listeners };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createReopen', () => {
  it('is absent without a hot object or without the reopen capability', () => {
    const { hot } = fakeHot();
    expect(createReopen({ hot: undefined, caps: ['reopen'] })).toBeUndefined();
    expect(createReopen({ hot, caps: undefined })).toBeUndefined();
    expect(createReopen({ hot, caps: 'reopen' })).toBeUndefined();
    expect(createReopen({ hot, caps: [] })).toBeUndefined();
    expect(createReopen({ hot, caps: ['reopen'] })).toBeDefined();
  });

  it('sends passback:reopen with the mark id and the comment', () => {
    const { hot } = fakeHot();
    void createReopen({ hot, caps: ['reopen'] })!.send('m1', 'again');
    expect(hot.on).toHaveBeenCalledWith('passback:status', expect.any(Function));
    expect(hot.send).toHaveBeenCalledWith('passback:reopen', {
      v: 1,
      markId: 'm1',
      comment: 'again',
    });
  });

  it('resolves true when the queued status of that mark arrives', async () => {
    const { hot, emit, listeners } = fakeHot();
    const p = createReopen({ hot, caps: ['reopen'] })!.send('m1', 'c');
    emit({ v: 1, markId: 'm1', state: 'queued' });
    await expect(p).resolves.toBe(true);
    expect(hot.off).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a queued status of another mark and a status that is not queued', async () => {
    const { hot, emit } = fakeHot();
    const p = createReopen({ hot, caps: ['reopen'] })!.send('m1', 'c');
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    emit({ v: 1, markId: 'm2', state: 'queued' });
    emit({ v: 1, markId: 'm1', state: 'fixed' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    emit({ v: 1, markId: 'm1', state: 'queued' });
    await expect(p).resolves.toBe(true);
  });

  it('resolves false when no queued status arrives within five seconds', async () => {
    const { hot, emit } = fakeHot();
    const p = createReopen({ hot, caps: ['reopen'] })!.send('m1', 'c');
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe(false);
    emit({ v: 1, markId: 'm1', state: 'queued' });
    await expect(p).resolves.toBe(false);
  });

  it('a second send for the same mark settles the first as false', async () => {
    const { hot, emit } = fakeHot();
    const port = createReopen({ hot, caps: ['reopen'] })!;
    const first = port.send('m1', 'a');
    const second = port.send('m1', 'b');
    await expect(first).resolves.toBe(false);
    emit({ v: 1, markId: 'm1', state: 'queued' });
    await expect(second).resolves.toBe(true);
  });

  it('failure: a hot object that throws on send resolves false', async () => {
    const { hot, listeners } = fakeHot(() => {
      throw new Error('closed');
    });
    const p = createReopen({ hot, caps: ['reopen'] })!.send('m1', 'c');
    await expect(p).resolves.toBe(false);
    expect(listeners.size).toBe(0);
  });

  it('reopenOf reads the hot object and the caps from window.__passback', () => {
    const { hot } = fakeHot();
    const win = { __passback: { hot, caps: ['reopen'] } } as unknown as Window & typeof globalThis;
    expect(reopenOf(win)).toBeDefined();
    expect(
      reopenOf({ __passback: { hot } } as unknown as Window & typeof globalThis),
    ).toBeUndefined();
    expect(reopenOf({} as unknown as Window & typeof globalThis)).toBeUndefined();
  });
});
