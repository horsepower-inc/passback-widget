// the outbox relay as a Server-Sent Events response, one relay per root.

import path from 'node:path';
import {
  listInbox,
  readAgentSession,
  startOutboxRelay,
  watchAgentSession,
} from '@passback/adapters/local';
import type { ChannelStatus } from '@passback/schema';
import { readSnapshot, type Snapshot } from './snapshot';

export type ItemsMessage = Snapshot;
export type StatusHub = {
  subscribe(
    send: (event: ChannelStatus) => void,
    sendItems?: (message: ItemsMessage) => void,
  ): () => void;
  scheduleItems(): void;
};

const KEEPALIVE_MS = 15_000;

export function createStatusHub(
  root: string,
  options: {
    pollMs?: number;
    debounceMs?: number;
    list?: typeof listInbox;
    agent?: typeof readAgentSession;
    watchSession?: typeof watchAgentSession;
  } = {},
): StatusHub {
  const subscribers = new Set<(event: ChannelStatus) => void>();
  const itemSenders = new Set<(message: ItemsMessage) => void>();
  const list = options.list ?? listInbox;
  const agent = options.agent ?? readAgentSession;
  const watchSession = options.watchSession ?? watchAgentSession;
  const debounceMs = options.debounceMs ?? 100;
  let stopWatch: (() => void) | undefined;
  let stopRelay: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reading = false;
  let again = false;

  const push = async (): Promise<void> => {
    timer = undefined;
    reading = true;
    try {
      const message = await readSnapshot({
        passbackDir: path.join(root, '.passback'),
        list,
        agent,
      });
      for (const sendItems of [...itemSenders]) sendItems(message);
    } catch (err) {
      console.warn(
        `[passback] could not list the inbox: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      reading = false;
      if (again) {
        again = false;
        scheduleItems();
      }
    }
  };

  const scheduleItems = (): void => {
    if (itemSenders.size === 0) return;
    if (reading) again = true;
    else if (timer === undefined) {
      timer = setTimeout(() => void push(), debounceMs);
      timer.unref();
    }
  };

  const fanOut = (event: ChannelStatus): void => {
    if (subscribers.size === 0) throw new Error('no status subscriber is connected');
    for (const send of [...subscribers]) send(event);
    scheduleItems();
  };

  return {
    scheduleItems,
    subscribe(send, sendItems) {
      subscribers.add(send);
      if (sendItems !== undefined) {
        itemSenders.add(sendItems);
        stopWatch ??= watchSession(path.join(root, '.passback'), () => scheduleItems());
      }
      stopRelay ??= startOutboxRelay(path.join(root, '.passback', 'outbox'), fanOut, {
        pollMs: options.pollMs,
        log: (message) => console.warn(`[passback] ${message}`),
      });
      return () => {
        subscribers.delete(send);
        if (sendItems !== undefined) itemSenders.delete(sendItems);
        if (itemSenders.size === 0) {
          stopWatch?.();
          stopWatch = undefined;
        }
        if (subscribers.size === 0) {
          clearTimeout(timer);
          timer = undefined;
          again = false;
          stopRelay?.();
          stopRelay = undefined;
        }
      };
    },
  };
}

type HubGlobal = typeof globalThis & { __passbackStatusHubs?: Map<string, StatusHub> };

export function getStatusHub(root: string): StatusHub {
  const g = globalThis as HubGlobal;
  const hubs = (g.__passbackStatusHubs ??= new Map());
  let hub = hubs.get(root);
  if (hub === undefined) {
    hub = createStatusHub(root);
    hubs.set(root, hub);
  }
  return hub;
}

export function eventsResponse(request: Request, hub: StatusHub): Response {
  const encoder = new TextEncoder();
  let release = (): void => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (text: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // the stream is already closed
        }
      };
      const unsubscribe = hub.subscribe(
        (event) => write(`data: ${JSON.stringify(event)}\n\n`),
        (message) => write(`event: passback:items\ndata: ${JSON.stringify(message)}\n\n`),
      );
      const timer = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS);
      timer.unref();
      release = (): void => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(timer);
        request.signal.removeEventListener('abort', release);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      write('retry: 1000\n\n');
      if (request.signal.aborted) release();
      else request.signal.addEventListener('abort', release);
    },
    cancel() {
      release();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
