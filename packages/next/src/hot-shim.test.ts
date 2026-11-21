// @vitest-environment happy-dom
// the hot shim over same-origin POST and EventSource.

import { describe, expect, it, vi } from 'vitest';
import { hotShimSource } from './hot-shim';

type Hot = {
  send(event: string, data: unknown): void;
  on(event: string, cb: (data: unknown) => void): void;
  off(event: string, cb: (data: unknown) => void): void;
};
type Win = { __passback?: { hot?: Hot; buildId?: string } };

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((m: { data: string }) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(): void {}
  close(): void {
    this.closed = true;
  }
  push(data: string): void {
    this.onmessage?.({ data });
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(
  base = '',
  buildId?: string,
  fetchImpl?: (url: string, init: RequestInit) => Promise<unknown>,
) {
  FakeEventSource.instances = [];
  const win: Win = {};
  const fetchFn = vi.fn(
    fetchImpl ??
      (async () => ({
        json: async () => ({ v: 1, batchId: 'b1', accepted: ['m1'], trimmed: [] }),
      })),
  );
  new Function('window', 'fetch', 'EventSource', hotShimSource(base, buildId))(
    win,
    fetchFn,
    FakeEventSource,
  );
  return { win, hot: win.__passback!.hot!, fetchFn };
}

const mark = { v: 1, batch: { id: 'b1', marks: [] } };

describe('hotShimSource', () => {
  it('installs window.__passback.hot with send, on and off', () => {
    const { hot } = setup();
    expect(typeof hot.send).toBe('function');
    expect(typeof hot.on).toBe('function');
    expect(typeof hot.off).toBe('function');
  });

  it('posts a passback:mark to the mark endpoint and re-emits the answer as passback:ack', async () => {
    const { hot, fetchFn } = setup();
    const acks: unknown[] = [];
    hot.on('passback:ack', () => {
      throw new Error('boom');
    });
    hot.on('passback:ack', (a) => acks.push(a));
    hot.send('passback:mark', mark);
    await flush();
    expect(fetchFn).toHaveBeenCalledWith('/api/passback/mark', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mark),
    });
    expect(acks).toEqual([{ v: 1, batchId: 'b1', accepted: ['m1'], trimmed: [] }]);
  });

  it('emits an error ack with the sent batch id and code network when the POST fails', async () => {
    const { hot } = setup('', undefined, async () => {
      throw new Error('down');
    });
    const acks: unknown[] = [];
    hot.on('passback:ack', (a) => acks.push(a));
    hot.send('passback:mark', mark);
    await flush();
    expect(acks).toEqual([
      {
        v: 1,
        batchId: 'b1',
        accepted: [],
        trimmed: [],
        error: { code: 'network', message: 'down' },
      },
    ]);
  });

  it('emits an error ack when the answer is not JSON', async () => {
    const { hot } = setup('', undefined, async () => ({
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }));
    const acks: Array<{ batchId: string; error: { code: string } }> = [];
    hot.on('passback:ack', (a) => acks.push(a as never));
    hot.send('passback:mark', mark);
    await flush();
    expect(acks).toHaveLength(1);
    expect(acks[0]!.batchId).toBe('b1');
    expect(acks[0]!.error.code).toBe('network');
  });

  it('posts a passback:orphaned to the orphaned endpoint and emits nothing', async () => {
    const { hot, fetchFn } = setup();
    const cb = vi.fn();
    hot.on('passback:ack', cb);
    hot.on('passback:status', cb);
    hot.send('passback:orphaned', { v: 1, markIds: ['m1'] });
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]![0]).toBe('/api/passback/orphaned');
    expect(cb).not.toHaveBeenCalled();
  });

  it('opens one EventSource on the first passback:status listener and re-emits its data frames', () => {
    const { hot } = setup();
    const a = vi.fn();
    const b = vi.fn();
    hot.on('passback:status', a);
    hot.on('passback:status', b);
    expect(FakeEventSource.instances).toHaveLength(1);
    const es = FakeEventSource.instances[0]!;
    expect(es.url).toBe('/api/passback/events');
    es.push('not json');
    es.push(JSON.stringify({ v: 1, id: 'm1' }));
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith({ v: 1, id: 'm1' });
    expect(b).toHaveBeenCalledWith({ v: 1, id: 'm1' });
  });

  it('closes the EventSource when the last passback:status listener is removed', () => {
    const { hot } = setup();
    const a = vi.fn();
    const b = vi.fn();
    hot.on('passback:status', a);
    hot.on('passback:status', b);
    hot.off('passback:status', a);
    expect(FakeEventSource.instances[0]!.closed).toBe(false);
    hot.off('passback:status', b);
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });

  it('stores listeners for vite:afterUpdate and never calls them', async () => {
    const { hot } = setup();
    const cb = vi.fn();
    hot.on('vite:afterUpdate', cb);
    hot.send('passback:mark', mark);
    await flush();
    expect(cb).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('prefixes every URL with the base path', async () => {
    const { hot, fetchFn } = setup('/docs');
    hot.on('passback:status', () => {});
    hot.send('passback:mark', mark);
    hot.send('passback:orphaned', { v: 1, markIds: [] });
    await flush();
    expect(FakeEventSource.instances[0]!.url).toBe('/docs/api/passback/events');
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([
      '/docs/api/passback/mark',
      '/docs/api/passback/orphaned',
    ]);
  });

  it('sets buildId next to hot and escapes a less-than sign', () => {
    const { win } = setup('', 'a<b');
    expect(win.__passback!.buildId).toBe('a<b');
    expect(win.__passback!.hot).toBeDefined();
    const source = hotShimSource('', 'a<b');
    expect(source).not.toContain('<');
    expect(source).toContain('\\u003c');
  });
});
