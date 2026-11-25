import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hot } from './channel';
import { createAnswer } from './answer';

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

describe('createAnswer', () => {
  it('is absent without a hot object or without the answer capability', () => {
    const { hot } = fakeHot();
    expect(createAnswer({ hot: undefined, caps: ['answer'] })).toBeUndefined();
    expect(createAnswer({ hot, caps: undefined })).toBeUndefined();
    expect(createAnswer({ hot, caps: 'answer' })).toBeUndefined();
    expect(createAnswer({ hot, caps: ['reopen'] })).toBeUndefined();
    expect(createAnswer({ hot, caps: ['answer'] })).toBeDefined();
  });

  it('sends passback:answer with the mark id and the text', () => {
    const { hot } = fakeHot();
    void createAnswer({ hot, caps: ['answer'] })!.send('m1', 'the blue one');
    expect(hot.on).toHaveBeenCalledWith('passback:status', expect.any(Function));
    expect(hot.send).toHaveBeenCalledWith('passback:answer', {
      v: 1,
      markId: 'm1',
      text: 'the blue one',
    });
  });

  it('resolves true when the running status of that mark arrives', async () => {
    const { hot, emit, listeners } = fakeHot();
    const p = createAnswer({ hot, caps: ['answer'] })!.send('m1', 't');
    emit({ v: 1, markId: 'm1', state: 'running' });
    await expect(p).resolves.toBe(true);
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores the running status of another mark', async () => {
    const { hot, emit } = fakeHot();
    const p = createAnswer({ hot, caps: ['answer'] })!.send('m1', 't');
    let settled = false;
    void p.then(() => {
      settled = true;
    });
    emit({ v: 1, markId: 'm2', state: 'running' });
    emit({ v: 1, markId: 'm1', state: 'question' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    emit({ v: 1, markId: 'm1', state: 'running' });
    await expect(p).resolves.toBe(true);
  });

  it('resolves false after the wait and releases the listener', async () => {
    const { hot, emit, listeners } = fakeHot();
    const p = createAnswer({ hot, caps: ['answer'] })!.send('m1', 't');
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe(false);
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    emit({ v: 1, markId: 'm1', state: 'running' });
    await expect(p).resolves.toBe(false);
  });

  it('resolves false when the channel cannot send', async () => {
    const { hot, listeners } = fakeHot(() => {
      throw new Error('closed');
    });
    const p = createAnswer({ hot, caps: ['answer'] })!.send('m1', 't');
    await expect(p).resolves.toBe(false);
    expect(listeners.size).toBe(0);
  });

  it('replaces a pending send for the same mark', async () => {
    const { hot, emit } = fakeHot();
    const port = createAnswer({ hot, caps: ['answer'] })!;
    const first = port.send('m1', 'a');
    const second = port.send('m1', 'b');
    await expect(first).resolves.toBe(false);
    emit({ v: 1, markId: 'm1', state: 'running' });
    await expect(second).resolves.toBe(true);
  });
});
