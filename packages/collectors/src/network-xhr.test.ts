// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { watchNetwork } from './network';
import type { Entry } from './ring';

class FakeXHR extends EventTarget {
  status = 0;
  responseText = '';
  responseType: XMLHttpRequestResponseType = '';
  method = '';
  url = '';

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  send(): void {
    // no real request leaves the test
  }
}

class ThrowOnceXHR extends FakeXHR {
  private thrown = false;

  override send(): void {
    if (!this.thrown) {
      this.thrown = true;
      throw new Error('already sending');
    }
  }
}

let stop: (() => void) | undefined;
let originalXHR: unknown;

afterEach(() => {
  stop?.();
  stop = undefined;
  if (originalXHR !== undefined) {
    (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = originalXHR;
    originalXHR = undefined;
  }
});

describe('watchNetwork: XMLHttpRequest', () => {
  function installFakeXHR(): void {
    originalXHR = (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest;
    (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
  }

  it('records an XMLHttpRequest with its status', () => {
    installFakeXHR();
    const entries: Entry[] = [];
    stop = watchNetwork(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    const xhr = new FakeXHR();
    xhr.open('GET', '/api/data');
    xhr.send();
    xhr.status = 204;
    xhr.dispatchEvent(new Event('loadend'));

    expect(entries).toEqual([
      { kind: 'network', url: '/api/data', method: 'GET', status: 204, ms: 0 },
    ]);
  });

  it('records an XMLHttpRequest failure body', () => {
    installFakeXHR();
    const entries: Entry[] = [];
    stop = watchNetwork(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    const xhr = new FakeXHR();
    xhr.open('POST', '/api/submit');
    xhr.send();
    xhr.status = 400;
    xhr.responseText = JSON.stringify({ error: 'bad request' });
    xhr.dispatchEvent(new Event('loadend'));

    expect(entries).toEqual([
      {
        kind: 'network',
        url: '/api/submit',
        method: 'POST',
        status: 400,
        ms: 0,
        body: JSON.stringify({ error: 'bad request' }),
      },
    ]);
  });

  it('does not record an entry for an XHR that completes after stop', () => {
    installFakeXHR();
    const entries: Entry[] = [];
    stop = watchNetwork(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    const xhr = new FakeXHR();
    xhr.open('GET', '/api/slow');
    xhr.send();
    stop();
    stop = undefined;
    xhr.status = 200;
    xhr.dispatchEvent(new Event('loadend'));

    expect(entries).toEqual([]);
  });

  it('does not double-record when send throws on a first attempt', () => {
    originalXHR = (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest;
    (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = ThrowOnceXHR;
    const entries: Entry[] = [];
    stop = watchNetwork(
      window,
      (entry) => entries.push(entry),
      () => 0,
    );

    const xhr = new ThrowOnceXHR();
    xhr.open('GET', '/api/retry');
    expect(() => xhr.send()).toThrow();
    xhr.send();
    xhr.status = 200;
    xhr.dispatchEvent(new Event('loadend'));

    expect(entries).toEqual([
      { kind: 'network', url: '/api/retry', method: 'GET', status: 200, ms: 0 },
    ]);
  });
});

describe('watchNetwork: stop', () => {
  it('restores fetch and XMLHttpRequest on stop', () => {
    originalXHR = (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest;
    (window as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
    const originalFetch = window.fetch;
    const originalOpen = FakeXHR.prototype.open;
    const originalSend = FakeXHR.prototype.send;

    stop = watchNetwork(
      window,
      () => {},
      () => 0,
    );
    stop();
    stop = undefined;

    expect(window.fetch).toBe(originalFetch);
    expect(FakeXHR.prototype.open).toBe(originalOpen);
    expect(FakeXHR.prototype.send).toBe(originalSend);
  });
});
