// @vitest-environment happy-dom
// the hot shim carries passback:reopen and lists the capability.

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

function setup(base = '') {
  const win: Win = {};
  const fetchFn = vi.fn(async (...args: [string, RequestInit]) => ({
    args,
    json: async () => ({}),
  }));
  new Function('window', 'fetch', 'EventSource', hotShimSource(base))(
    win,
    fetchFn,
    FakeEventSource,
  );
  return { win, hot: win.__passback!.hot!, fetchFn };
}

const reopen = { v: 1, markId: '01J8Z3K4M5N6P7Q8R9S0T1V2W3', comment: 'still wrong' };

describe('hotShimSource reopen', () => {
  it('posts a passback:reopen to the reopen endpoint and emits nothing', async () => {
    const { hot, fetchFn } = setup();
    const cb = vi.fn();
    hot.on('passback:ack', cb);
    hot.on('passback:status', cb);
    hot.send('passback:reopen', reopen);
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/api/passback/reopen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(reopen),
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it('lists the reopen and clear capabilities next to hot', () => {
    const { win } = setup();
    expect(win.__passback!.caps).toEqual(['reopen', 'verdict', 'list', 'clear']);
    expect(win.__passback!.hot).toBeDefined();
  });

  it('prefixes the reopen URL with the base path', async () => {
    const { hot, fetchFn } = setup('/docs');
    hot.send('passback:reopen', reopen);
    await flush();
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual(['/docs/api/passback/reopen']);
  });
});
