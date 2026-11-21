// @vitest-environment happy-dom
// the hot shim carries passback:verified and lists the capability.

import { describe, expect, it, vi } from 'vitest';
import { hotShimSource } from './hot-shim';

type Hot = {
  send(event: string, data: unknown): void;
  on(event: string, cb: (data: unknown) => void): void;
};
type Win = { __passback?: { hot?: Hot; caps?: string[] } };

class FakeEventSource {
  onmessage: ((m: { data: string }) => void) | null = null;
  constructor(public url: string) {}
  addEventListener(): void {}
  close(): void {}
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(fetchFn: (...args: [string, RequestInit]) => Promise<unknown>) {
  const win: Win = {};
  new Function('window', 'fetch', 'EventSource', hotShimSource(''))(win, fetchFn, FakeEventSource);
  return { win, hot: win.__passback!.hot! };
}

const verified = { v: 1, markIds: ['01J8Z3K4M5N6P7Q8R9S0T1V2W3'] };

describe('hotShimSource verified', () => {
  it('posts passback:verified to the verified route and ignores a network failure', async () => {
    const ok = vi.fn(async () => ({}));
    const first = setup(ok);
    const cb = vi.fn();
    first.hot.on('passback:ack', cb);
    first.hot.send('passback:verified', verified);
    await flush();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledWith('/api/passback/verified', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(verified),
    });
    expect(cb).not.toHaveBeenCalled();

    const rejecting = vi.fn(async () => {
      throw new Error('offline');
    });
    const second = setup(rejecting);
    expect(() => second.hot.send('passback:verified', verified)).not.toThrow();
    await flush();
    expect(rejecting).toHaveBeenCalledTimes(1);

    const throwing = vi.fn((): Promise<unknown> => {
      throw new Error('sync');
    });
    const third = setup(throwing);
    expect(() => third.hot.send('passback:verified', verified)).not.toThrow();
  });

  it('lists verified among the capabilities after the existing four', () => {
    const { win } = setup(async () => ({}));
    expect(win.__passback!.caps).toEqual(['reopen', 'verdict', 'list', 'clear', 'verified', 'answer']);
  });
});
