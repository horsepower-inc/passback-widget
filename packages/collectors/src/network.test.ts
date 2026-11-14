// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Timeline } from '@passback/schema';
import { BODY_MAX, watchNetwork } from './network';
import { startTimeline, type TimelineHandle } from './timeline';
import type { Entry } from './ring';

let stop: (() => void) | undefined;
let handle: TimelineHandle | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  handle?.stop();
  handle = undefined;
});

describe('watchNetwork: fetch', () => {
  it('records a failed fetch with status and body', async () => {
    const entries: Entry[] = [];
    window.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'price service down' }), { status: 500 }),
      );
    stop = watchNetwork(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    await window.fetch('/api/price');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(entries).toEqual([
      {
        kind: 'network',
        url: '/api/price',
        method: 'GET',
        status: 500,
        ms: 0,
        body: JSON.stringify({ error: 'price service down' }),
      },
    ]);
  });

  it('caps a failure body at 4096 characters', async () => {
    const entries: Entry[] = [];
    window.fetch = vi
      .fn()
      .mockResolvedValue(new Response('x'.repeat(BODY_MAX + 100), { status: 500 }));
    stop = watchNetwork(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    await window.fetch('/api/big');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const [entry] = entries;
    expect(entry?.kind === 'network' ? entry.body?.length : undefined).toBe(BODY_MAX);
  });

  it('omits the body on a 2xx response', async () => {
    const entries: Entry[] = [];
    window.fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    stop = watchNetwork(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    await window.fetch('/api/ok');

    expect(entries).toEqual([
      { kind: 'network', url: '/api/ok', method: 'GET', status: 200, ms: 0 },
    ]);
  });

  it('records a network error as status 0 and rethrows', async () => {
    const entries: Entry[] = [];
    const error = new Error('network down');
    window.fetch = vi.fn().mockRejectedValue(error);
    stop = watchNetwork(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    await expect(window.fetch('/api/flaky')).rejects.toBe(error);

    expect(entries).toEqual([
      { kind: 'network', url: '/api/flaky', method: 'GET', status: 0, ms: 0 },
    ]);
  });

  it('records method and url of a Request object', async () => {
    const entries: Entry[] = [];
    window.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    stop = watchNetwork(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    const request = new Request('/api/submit', { method: 'post' });
    await window.fetch(request);

    expect(entries).toEqual([
      { kind: 'network', url: request.url, method: 'POST', status: 200, ms: 0 },
    ]);
  });

  it('returns the response to the caller unchanged', async () => {
    const response = new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
    window.fetch = vi.fn().mockResolvedValue(response);
    stop = watchNetwork(
      window,
      () => {},
      () => 0,
    );

    const result = await window.fetch('/api/thing');

    expect(result).toBe(response);
    await expect(result.text()).resolves.toBe(JSON.stringify({ error: 'boom' }));
  });

  it('reads a streaming failure body only up to the cap', async () => {
    const entries: Entry[] = [];
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(1000)));
      },
    });
    window.fetch = vi.fn().mockResolvedValue(new Response(stream, { status: 500 }));
    stop = watchNetwork(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    await window.fetch('/api/stream');
    await vi.waitFor(() => expect(entries).toHaveLength(1));

    const [entry] = entries;
    expect(entry?.kind === 'network' ? entry.body?.length : undefined).toBe(BODY_MAX);
  });

  it('does not record an entry for a fetch that completes after stop', async () => {
    const entries: Entry[] = [];
    let resolveFetch: ((response: Response) => void) | undefined;
    window.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    stop = watchNetwork(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    const pending = window.fetch('/api/slow');
    stop();
    stop = undefined;
    resolveFetch?.(new Response('ok', { status: 200 }));
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(entries).toEqual([]);
  });
});

describe('watchNetwork: schema', () => {
  it('validates a network snapshot against the schema Timeline', async () => {
    window.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: 'down' }), { status: 502 }));
    handle = startTimeline(window, () => 0);

    await window.fetch('/api/price');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = handle.snapshot();
    expect(() => Timeline.parse(snapshot)).not.toThrow();
  });
});
