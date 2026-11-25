// @vitest-environment happy-dom
// the hot shim carries passback:answer and lists the capability.

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

const answer = { v: 1, markId: '01J8Z3K4M5N6P7Q8R9S0T1V2W3', text: 'the blue one' };

describe('hotShimSource answer', () => {
  it('posts a passback:answer to the answer endpoint and emits nothing', async () => {
    const { hot, fetchFn } = setup();
    const cb = vi.fn();
    hot.on('passback:ack', cb);
    hot.on('passback:status', cb);
    hot.send('passback:answer', answer);
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/api/passback/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(answer),
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it('lists the answer capability after clear', () => {
    const { win } = setup();
    const caps = win.__passback!.caps!;
    expect(caps).toContain('answer');
    expect(caps.indexOf('answer')).toBeGreaterThan(caps.indexOf('clear'));
  });
});
