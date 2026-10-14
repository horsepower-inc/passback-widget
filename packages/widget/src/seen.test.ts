// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Widget } from './index';
import { HOST_ATTRIBUTE } from './mount';
import { pingSeen } from './seen';

type Passback = { autoStart: boolean; hot?: unknown };

const ENDPOINT = 'https://api.example.com/v1/ingest/pb_a';
const SEEN = `${ENDPOINT}/seen`;

function setPassback(value: Passback): void {
  (window as unknown as { __passback?: Passback }).__passback = value;
}

function addEndpoint(): void {
  const script = document.createElement('script');
  script.setAttribute('data-passback-endpoint', ENDPOINT);
  document.head.appendChild(script);
}

let widgets: Widget[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

async function startWidget(): Promise<void> {
  const { start } = await import('./index');
  widgets.push(start());
}

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  window.fetch = fetchMock as unknown as typeof window.fetch;
});

afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  widgets = [];
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete (window as unknown as { __passback?: Passback }).__passback;
  vi.restoreAllMocks();
});

describe('pingSeen', () => {
  it('posts once to the seen address with no body and no credentials', async () => {
    const status = await pingSeen(ENDPOINT, window);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(SEEN, { method: 'POST', credentials: 'omit' });
    expect(status).toBe(204);
  });

  it('drops a trailing slash of the endpoint', async () => {
    await pingSeen(`${ENDPOINT}/`, window);
    expect(fetchMock).toHaveBeenCalledWith(SEEN, { method: 'POST', credentials: 'omit' });
  });

  it('resolves 0 when the request fails or there is no fetch', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await pingSeen(ENDPOINT, window)).toBe(0);
    const bare = {} as unknown as Window & typeof globalThis;
    expect(await pingSeen(ENDPOINT, bare)).toBe(0);
  });
});

describe('ping on start', () => {
  it('pings the relay when the widget starts on a page with an endpoint and no HMR channel', async () => {
    addEndpoint();
    setPassback({ autoStart: false });
    await startWidget();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(SEEN, { method: 'POST', credentials: 'omit' });
  });

  it('does not ping when the page has an HMR channel', async () => {
    addEndpoint();
    setPassback({ autoStart: false, hot: { send() {}, on() {}, off() {} } });
    await startWidget();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not ping when the script has no endpoint', async () => {
    setPassback({ autoStart: false });
    await startWidget();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ping answered 402', () => {
  const hostOf = (): Element | null => document.querySelector(`[${HOST_ATTRIBUTE}]`);
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('removes the widget when the ping answers 402', async () => {
    addEndpoint();
    setPassback({ autoStart: false });
    fetchMock.mockResolvedValueOnce(new Response('{"code":"account_paused"}', { status: 402 }));
    await startWidget();
    await settle();
    expect(hostOf()).toBeNull();
  });

  it('keeps the widget when the ping answers 204, 404 or not at all', async () => {
    const answers: Array<() => Promise<Response>> = [
      async () => new Response(null, { status: 204 }),
      async () => new Response(null, { status: 404 }),
      async () => Promise.reject(new Error('offline')),
    ];
    for (const answer of answers) {
      addEndpoint();
      setPassback({ autoStart: false });
      fetchMock.mockImplementationOnce(answer);
      await startWidget();
      await settle();
      expect(hostOf()).not.toBeNull();
      widgets.forEach((widget) => widget.stop());
      widgets = [];
      document.head.innerHTML = '';
    }
  });

  it('keeps a widget that was started again before a late 402 arrived', async () => {
    addEndpoint();
    setPassback({ autoStart: false });
    let answerFirst: (response: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (answerFirst = resolve)),
    );
    await startWidget();
    widgets[0]!.stop();
    await startWidget();
    await settle();
    answerFirst(new Response('{"code":"account_paused"}', { status: 402 }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hostOf()).not.toBeNull();
  });
});
