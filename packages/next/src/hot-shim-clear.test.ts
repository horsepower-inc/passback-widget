// @vitest-environment happy-dom
// the hot shim carries passback:clear and answers with passback:cleared.

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

const cleared = {
  v: 1,
  scope: 'fixed',
  comments: 2,
  attachments: 1,
  answers: 0,
  done: 0,
  settings: false,
};
const clear = { v: 1, scope: 'fixed' };

function setup(fetchImpl: (...args: [string, RequestInit]) => Promise<unknown>, base = '') {
  const win: Win = {};
  const fetchFn = vi.fn(fetchImpl);
  new Function('window', 'fetch', 'EventSource', hotShimSource(base))(
    win,
    fetchFn,
    FakeEventSource,
  );
  return { hot: win.__passback!.hot!, fetchFn };
}

const answering = async () => ({ ok: true, json: async () => cleared });

describe('hotShimSource clear', () => {
  it('posts a passback:clear to the clear endpoint and emits passback:cleared with the answer', async () => {
    const { hot, fetchFn } = setup(answering);
    const cb = vi.fn();
    hot.on('passback:cleared', cb);
    hot.send('passback:clear', clear);
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/api/passback/clear', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(clear),
    });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(cleared);
  });

  it('emits nothing when the clear request is refused or the network fails', async () => {
    const refused = setup(async () => ({ ok: false, json: async () => cleared }));
    const failing = setup(async () => {
      throw new Error('offline');
    });
    const cb = vi.fn();
    refused.hot.on('passback:cleared', cb);
    failing.hot.on('passback:cleared', cb);
    refused.hot.send('passback:clear', clear);
    failing.hot.send('passback:clear', clear);
    await flush();
    expect(refused.fetchFn).toHaveBeenCalledTimes(1);
    expect(failing.fetchFn).toHaveBeenCalledTimes(1);
    expect(cb).not.toHaveBeenCalled();
  });

  it('prefixes the clear URL with the base path', async () => {
    const { hot, fetchFn } = setup(answering, '/docs');
    hot.send('passback:clear', clear);
    await flush();
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual(['/docs/api/passback/clear']);
  });
});
