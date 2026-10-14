import type { Entry } from './ring';

export const BODY_MAX = 4096;

// `XMLHttpRequest` is a global, not a member of the DOM `Window` type; this reaches it on the given window.
type WindowWithXHR = Window & Pick<typeof globalThis, 'XMLHttpRequest'>;

type NetworkEntry = Extract<Entry, { kind: 'network' }>;

function safeRecord(record: () => void): void {
  try {
    record();
  } catch {
    // swallow: the host's call must still complete
  }
}

function fetchMethod(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function fetchUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return input;
}

async function readCappedText(response: Response): Promise<string> {
  const body = response.clone().body;
  if (!body) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < BODY_MAX) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    // Not awaited: a sibling branch from `response.clone()`'s tee can leave this pending forever
    // (e.g. an endless stream the caller never reads), and only the cap matters here.
    reader.cancel().catch(() => {});
  }
  return text.slice(0, BODY_MAX);
}

async function recordFailureBody(
  response: Response,
  entry: NetworkEntry,
  push: (entry: Entry) => void,
): Promise<void> {
  try {
    const body = await readCappedText(response);
    safeRecord(() => push({ ...entry, body }));
  } catch {
    safeRecord(() => push(entry));
  }
}

function wrapFetch(win: Window, push: (entry: Entry) => void, now: () => number): () => void {
  const trueOriginal = win.fetch;
  const original = trueOriginal.bind(win);

  win.fetch = async function fetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const start = now();
    const method = fetchMethod(input, init);
    const url = fetchUrl(input);

    let response: Response;
    try {
      response = await original(input, init);
    } catch (error) {
      const ms = Math.round(now() - start);
      safeRecord(() => push({ kind: 'network', url, method, status: 0, ms }));
      throw error;
    }

    const ms = Math.round(now() - start);
    const entry: NetworkEntry = { kind: 'network', url, method, status: response.status, ms };
    if (response.status >= 400) {
      recordFailureBody(response, entry, push);
    } else {
      safeRecord(() => push(entry));
    }
    return response;
  };

  return () => {
    win.fetch = trueOriginal;
  };
}

function recordXhrLoad(
  xhr: XMLHttpRequest,
  request: { method: string; url: string } | undefined,
  clock: { start: number; now: () => number },
  push: (entry: Entry) => void,
): void {
  safeRecord(() => {
    if (!request) return;
    const status = xhr.status || 0;
    const entry: Entry = {
      kind: 'network',
      url: request.url,
      method: request.method,
      status,
      ms: Math.round(clock.now() - clock.start),
    };
    const hasTextBody = xhr.responseType === '' || xhr.responseType === 'text';
    push(
      status >= 400 && hasTextBody
        ? { ...entry, body: xhr.responseText.slice(0, BODY_MAX) }
        : entry,
    );
  });
}

function wrapXHR(win: Window, push: (entry: Entry) => void, now: () => number): () => void {
  const XHR = (win as WindowWithXHR).XMLHttpRequest;
  const trueOriginalOpen = XHR.prototype.open;
  const trueOriginalSend = XHR.prototype.send;
  const requests = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

  const wrappedOpen = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    requests.set(this, { method: method.toUpperCase(), url: String(url) });
    (trueOriginalOpen as (...args: unknown[]) => void).apply(this, [method, url, ...rest]);
  } as XMLHttpRequest['open'];

  const wrappedSend = function (this: XMLHttpRequest, ...args: unknown[]): void {
    const request = requests.get(this);
    const start = now();
    const onLoadEnd = (): void => recordXhrLoad(this, request, { start, now }, push);
    this.addEventListener('loadend', onLoadEnd, { once: true });
    try {
      (trueOriginalSend as (...args: unknown[]) => void).apply(this, args);
    } catch (error) {
      this.removeEventListener('loadend', onLoadEnd);
      throw error;
    }
  } as XMLHttpRequest['send'];

  XHR.prototype.open = wrappedOpen;
  XHR.prototype.send = wrappedSend;

  return () => {
    if (XHR.prototype.open === wrappedOpen) XHR.prototype.open = trueOriginalOpen;
    if (XHR.prototype.send === wrappedSend) XHR.prototype.send = trueOriginalSend;
  };
}

export function watchNetwork(
  win: Window,
  push: (entry: Entry) => void,
  now: () => number,
): () => void {
  let active = true;
  const guardedPush = (entry: Entry): void => {
    if (active) push(entry);
  };

  const restoreFetch = wrapFetch(win, guardedPush, now);
  const restoreXHR = wrapXHR(win, guardedPush, now);

  return () => {
    active = false;
    restoreFetch();
    restoreXHR();
  };
}
