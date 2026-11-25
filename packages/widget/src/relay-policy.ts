import { readScriptConfig } from './collector-loader';

export type TransportPolicy = { maxBytes: number; gzip: boolean };
export type PicturePlan = { screenshots?: unknown; drawings?: unknown };
type Answer = { plan: PicturePlan | null; transport?: TransportPolicy };
type Entry = { answer?: Answer; waiting: Array<(answer: Answer) => void> };

// One discovery per page and policy URL; the answer lives only as long as the page.
// Keyed by the page's own fetch, which never changes on a real page; a replaced fetch is a different page.
const pages = new WeakMap<object, Map<string, Entry>>();

export function relayPolicyUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, '')}/screenshots`;
}

function transportOf(plan: Record<string, unknown>): TransportPolicy | undefined {
  const { maxBytes, gzip } = plan;
  if (typeof maxBytes !== 'number' || !Number.isFinite(maxBytes) || maxBytes <= 0) return undefined;
  return { maxBytes, gzip: gzip === true };
}

function settle(entry: Entry, answer: Answer): void {
  entry.answer = answer;
  const waiting = entry.waiting.splice(0);
  for (const fn of waiting) {
    try {
      fn(answer);
    } catch {
      // A listener that throws must not stop the others.
    }
  }
}

function discover(win: Window, url: string): Entry {
  const known = pages.get(win.fetch) ?? new Map<string, Entry>();
  pages.set(win.fetch, known);
  const found = known.get(url);
  if (found) return found;
  const entry: Entry = { waiting: [] };
  known.set(url, entry);
  try {
    win
      .fetch(url, { credentials: 'omit' })
      .then((res) => res.status === 200 && res.json())
      .then((body: unknown) => {
        if (!body || typeof body !== 'object') return;
        const plan = body as Record<string, unknown>;
        settle(entry, { plan, transport: transportOf(plan) });
      })
      .catch(() => undefined);
  } catch {
    // A request that cannot start leaves no policy and is not retried.
  }
  return entry;
}

/** Asks the relay once per page and calls `listener` with its picture plan when a 200 answer arrives. */
export function watchRelayPolicy(
  win: Window,
  url: string,
  listener: (plan: PicturePlan) => void,
): void {
  const entry = discover(win, url);
  const apply = (answer: Answer): void => {
    if (answer.plan) listener(answer.plan);
  };
  if (entry.answer) apply(entry.answer);
  else entry.waiting.push(apply);
}

/** Starts discovery for the relay endpoint on the widget script, if there is one. */
export function startRelayPolicy(doc: Document, win: Window): void {
  const { endpoint } = readScriptConfig(doc);
  if (endpoint) discover(win, relayPolicyUrl(endpoint));
}

/** The relay's advertised transport limits, once its answer has arrived with a `maxBytes`. */
export function readRelayPolicy(doc: Document, win: Window): TransportPolicy | undefined {
  const { endpoint } = readScriptConfig(doc);
  if (!endpoint) return undefined;
  const transport = pages.get(win.fetch)?.get(relayPolicyUrl(endpoint))?.answer?.transport;
  return transport && { ...transport };
}
