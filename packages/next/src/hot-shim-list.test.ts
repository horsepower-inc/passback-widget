// @vitest-environment happy-dom
// and the hot shim carries passback:list and passback:items.

import { describe, expect, it, vi } from 'vitest';
import { hotShimSource } from './hot-shim';

type Cb = (data: unknown) => void;
type Hot = {
  send(event: string, data: unknown): void;
  on(event: string, cb: Cb): void;
  off(event: string, cb: Cb): void;
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((m: { data: string }) => void) | null = null;
  closed = false;
  named = new Map<string, Array<(m: { data: string }) => void>>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, cb: (m: { data: string }) => void): void {
    this.named.set(name, [...(this.named.get(name) ?? []), cb]);
  }
  close(): void {
    this.closed = true;
  }
  pushNamed(name: string, data: string): void {
    for (const cb of this.named.get(name) ?? []) cb({ data });
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(fetchImpl: () => Promise<unknown>) {
  FakeEventSource.instances = [];
  const win: { __passback?: { hot?: Hot } } = {};
  const fetchFn = vi.fn(fetchImpl);
  new Function('window', 'fetch', 'EventSource', hotShimSource(''))(win, fetchFn, FakeEventSource);
  return { hot: win.__passback!.hot!, fetchFn };
}

const snapshot = { v: 1, items: [{ id: 'm1' }], truncated: false };

describe('hotShimSource list', () => {
  it('posts passback:list and emits the answered rows as passback:items', async () => {
    const { hot, fetchFn } = setup(async () => ({ ok: true, json: async () => snapshot }));
    const got: unknown[] = [];
    hot.on('passback:items', (d) => got.push(d));
    hot.send('passback:list', { v: 1 });
    await flush();
    expect(fetchFn).toHaveBeenCalledWith('/api/passback/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1 }),
    });
    expect(got).toEqual([snapshot]);
  });

  it('emits nothing for a failed list answer', async () => {
    const cb = vi.fn();
    for (const impl of [
      async () => ({ ok: false, json: async () => snapshot }),
      async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError('bad');
        },
      }),
      async () => {
        throw new Error('down');
      },
    ]) {
      const { hot } = setup(impl);
      hot.on('passback:items', cb);
      hot.send('passback:list', { v: 1 });
      await flush();
    }
    expect(cb).not.toHaveBeenCalled();
  });

  it('opens the stream for an items listener and emits named passback:items frames', () => {
    const { hot } = setup(async () => ({ ok: true, json: async () => snapshot }));
    const cb = vi.fn();
    hot.on('passback:items', cb);
    expect(FakeEventSource.instances).toHaveLength(1);
    const es = FakeEventSource.instances[0]!;
    es.pushNamed('passback:items', 'not json');
    es.pushNamed('passback:items', JSON.stringify(snapshot));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(snapshot);
  });

  it('closes the stream only when the last status and items listener is gone', () => {
    const { hot } = setup(async () => ({ ok: true, json: async () => snapshot }));
    const status = vi.fn();
    const items = vi.fn();
    hot.on('passback:status', status);
    hot.on('passback:items', items);
    expect(FakeEventSource.instances).toHaveLength(1);
    hot.off('passback:status', status);
    expect(FakeEventSource.instances[0]!.closed).toBe(false);
    hot.off('passback:items', items);
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });
});
