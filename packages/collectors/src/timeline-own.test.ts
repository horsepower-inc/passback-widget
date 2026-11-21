// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTimeline, type TimelineHandle } from './timeline';

class FakeXHR extends EventTarget {
  status = 200;
  responseText = '';
  responseType: XMLHttpRequestResponseType = '';

  open(_method: string, url: string | URL): void {
    if (String(url).endsWith('/throw')) throw new Error('bad url');
  }

  send(): void {
    this.dispatchEvent(new Event('loadend'));
  }
}

const win = window as unknown as { XMLHttpRequest: unknown };
const originalFetch = window.fetch;
const originalXHR = win.XMLHttpRequest;
let handle: TimelineHandle | undefined;

afterEach(() => {
  handle?.stop();
  handle = undefined;
  window.fetch = originalFetch;
  win.XMLHttpRequest = originalXHR;
  document.head.querySelectorAll('base').forEach((base) => base.remove());
});

function start(): TimelineHandle {
  window.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
  win.XMLHttpRequest = FakeXHR;
  handle = startTimeline(window, () => 0);
  return handle;
}

function setBase(href: string): void {
  const base = document.createElement('base');
  base.href = href;
  document.head.append(base);
}

function xhr(url: string | URL): void {
  const request = new (win.XMLHttpRequest as typeof FakeXHR)();
  request.open('POST', url);
  request.send();
}

function urls(timeline: TimelineHandle): string[] {
  return timeline
    .snapshot()
    .filter((event) => event.kind === 'network')
    .map((event) => (event as { url: string }).url);
}

describe('startTimeline: the widget own relay upload', () => {
  it('leaves string requests to the relay ingest routes out of the timeline', async () => {
    const timeline = start();

    await window.fetch('https://relay.example/v1/ingest/lab/screenshots', { method: 'POST' });
    await window.fetch('/v1/ingest/lab', { method: 'POST' });
    xhr('https://relay.example/v1/ingest/lab/voice');
    xhr('/v1/ingest/lab/seen');

    expect(urls(timeline)).toEqual([]);
  });

  it('keeps the page own string requests in the timeline', async () => {
    const timeline = start();

    await window.fetch('/api/items');
    await window.fetch('/v1/ingestion/lab');
    await window.fetch('/v1/ingest/');
    xhr('/api/cart');

    setBase('https://shop.example/docs/');
    xhr('v1/ingest/lab/voice');
    setBase('https://shop.example/api/');
    await window.fetch('items');

    expect(urls(timeline)).toEqual([
      '/api/items',
      '/v1/ingestion/lab',
      '/v1/ingest/',
      '/api/cart',
      'v1/ingest/lab/voice',
      'items',
    ]);
  });

  it('still records a URL object address as before', async () => {
    const timeline = start();
    const address = new URL('https://relay.example/v1/ingest/lab/screenshots');

    const response = await window.fetch(address, { method: 'POST' });
    xhr(address);

    expect(response.status).toBe(201);
    expect(window.fetch).not.toBe(originalFetch);
    expect(urls(timeline)).toEqual([address.href, address.href]);
  });

  it('keeps an earlier open when a later open to an ingest route throws', () => {
    const timeline = start();
    const request = new (win.XMLHttpRequest as typeof FakeXHR)();
    request.open('GET', '/api/first');

    expect(() => request.open('POST', '/v1/ingest/lab/throw')).toThrow('bad url');
    request.send();

    expect(urls(timeline)).toEqual(['/api/first']);
  });
});
