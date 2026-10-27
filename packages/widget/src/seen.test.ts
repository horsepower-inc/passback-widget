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

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

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

  it('pings the relay and keeps the 200 answer on a page that also has an HMR channel', async () => {
    addEndpoint();
    setPassback({ autoStart: false, hot: { send() {}, on() {}, off() {} } });
    const answer = { subscription: 'active', tracker: 'linear' };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(answer), { status: 200 }));
    await startWidget();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(SEEN, { method: 'POST', credentials: 'omit' });
    expect(widgets[0]!.relay()).toEqual(answer);
  });

  it('does not ping when the script has no endpoint', async () => {
    setPassback({ autoStart: false });
    await startWidget();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ping body', () => {
  it('hands the JSON body of a 200 answer to onBody and drops other statuses and a body that is not JSON', async () => {
    const onBody = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response('{"subscription":"none","tracker":null}'));
    expect(await pingSeen(ENDPOINT, window, onBody)).toBe(200);
    expect(onBody).toHaveBeenCalledTimes(1);
    expect(onBody).toHaveBeenCalledWith({ subscription: 'none', tracker: null });
    fetchMock.mockResolvedValueOnce(new Response('{"a":1}', { status: 402 }));
    expect(await pingSeen(ENDPOINT, window, onBody)).toBe(402);
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    expect(await pingSeen(ENDPOINT, window, onBody)).toBe(200);
    expect(onBody).toHaveBeenCalledTimes(1);
  });
});

describe('ping answered 402', () => {
  const hostOf = (): Element | null => document.querySelector(`[${HOST_ATTRIBUTE}]`);

  it('removes the widget when the ping answers 402', async () => {
    addEndpoint();
    setPassback({ autoStart: false });
    fetchMock.mockResolvedValueOnce(new Response('{"code":"account_paused"}', { status: 402 }));
    await startWidget();
    await settle();
    expect(hostOf()).toBeNull();
  });

  it('keeps the widget on a page with an HMR channel when the ping answers 402', async () => {
    addEndpoint();
    setPassback({ autoStart: false, hot: { send() {}, on() {}, off() {} } });
    fetchMock.mockResolvedValueOnce(new Response('{"code":"account_paused"}', { status: 402 }));
    await startWidget();
    await settle();
    expect(hostOf()).not.toBeNull();
  });

  it('returns null from relay until a 200 answer arrives and after a 204 answer', async () => {
    addEndpoint();
    setPassback({ autoStart: false });
    let answer: (response: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
    await startWidget();
    expect(widgets[0]!.relay()).toBeNull();
    answer(new Response('{"subscription":"active","tracker":"x"}', { status: 200 }));
    await settle();
    expect(widgets[0]!.relay()).toEqual({ subscription: 'active', tracker: 'x' });
    widgets[0]!.stop();
    widgets = [];
    await startWidget();
    await settle();
    expect(widgets[0]!.relay()).toBeNull();
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
