// the HMR channel, wired into Vite's dev server. Widget and plugin meet
// only on `server.ws` (no extra port, no CORS); plugin and daemon meet only on the filesystem
// (04 Decisions, 2026-09-27).

import path from 'node:path';
import {
  acceptMark,
  acceptOrphaned,
  acceptReopen,
  acceptVerdict,
  clearInbox,
  FileInboxAdapter,
  startOutboxRelay,
} from '@passback/adapters/local';
import type { TrackerAdapter } from '@passback/adapters/local';
import { CHANNEL_EVENTS, ChannelList } from '@passback/schema';
import type { ChannelAck } from '@passback/schema';
import { createItemsPush } from './channel-items';

const NIL_BATCH_ID = '00000000000000000000000000';

export type ChannelClient = { send(event: string, payload: unknown): void };

export type ChannelServer = {
  ws: {
    on(event: string, listener: (data: unknown, client: ChannelClient) => void): void;
    send(event: string, payload: unknown): void;
  };
  httpServer?: { once(event: 'close', listener: () => void): void } | null;
};

export type AttachChannelOptions = {
  root: string;
  log?: (message: string) => void;
  adapter?: TrackerAdapter | undefined;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorAck(message: string): ChannelAck {
  return {
    v: 1,
    batchId: NIL_BATCH_ID,
    accepted: [],
    trimmed: [],
    error: { code: 'write_failed', message },
  };
}

/** Wires 's HMR channel into a Vite dev server: every `passback:mark` is
 * written to `<root>/.passback/inbox` via `acceptMark` and acked to the sending client only;
 * every `<root>/.passback/outbox` status event is relayed to all clients unchanged. Returns a
 * stop function that also runs once when the server's http server closes. */
export function attachChannel(server: ChannelServer, opts: AttachChannelOptions): () => void {
  const log = opts.log ?? ((): void => {});
  const adapter =
    opts.adapter ?? new FileInboxAdapter({ root: path.join(opts.root, '.passback', 'inbox') });

  const items = createItemsPush({
    passbackDir: path.join(opts.root, '.passback'),
    broadcast: (m) => server.ws.send(CHANNEL_EVENTS.items, m),
    log,
  });

  server.ws.on(CHANNEL_EVENTS.list, (data, client) => {
    if (!ChannelList.safeParse(data).success) {
      log('channel: list ignored (invalid payload)');
      return;
    }
    void items.snapshot().then((message) => {
      if (message) client.send(CHANNEL_EVENTS.items, message);
    });
  });

  server.ws.on(CHANNEL_EVENTS.mark, (data, client) => {
    acceptMark(adapter, data)
      .then((ack) => client.send(CHANNEL_EVENTS.ack, ack))
      .catch((err: unknown) => {
        const message = errorMessage(err);
        log(`channel: mark handling failed (${message})`);
        client.send(CHANNEL_EVENTS.ack, errorAck(message));
      })
      .finally(items.schedule);
  });

  server.ws.on(CHANNEL_EVENTS.orphaned, (data) => {
    acceptOrphaned(path.join(opts.root, '.passback', 'inbox'), data)
      .catch((err: unknown) => {
        log(`channel: orphaned handling failed (${errorMessage(err)})`);
      })
      .finally(items.schedule);
  });

  server.ws.on(CHANNEL_EVENTS.reopen, (data) => {
    acceptReopen(path.join(opts.root, '.passback'), data)
      .then((applied) => {
        if (!applied) log('channel: reopen not applied');
      })
      .catch((err: unknown) => {
        log(`channel: reopen handling failed (${errorMessage(err)})`);
      })
      .finally(items.schedule);
  });

  server.ws.on(CHANNEL_EVENTS.clear, (data, client) => {
    clearInbox(path.join(opts.root, '.passback'), data)
      .then((result) => {
        if (result.ok) client.send(CHANNEL_EVENTS.cleared, result.cleared);
        else log(`channel: clear not applied (${result.error})`);
      })
      .catch((err: unknown) => log(`channel: clear handling failed (${errorMessage(err)})`))
      .finally(items.schedule);
  });

  server.ws.on(CHANNEL_EVENTS.verdict, (data, client) => {
    acceptVerdict(path.join(opts.root, '.passback'), data)
      .then(async (result) => {
        if (result.ok) {
          items.schedule();
          return;
        }
        log(`channel: verdict refused (${result.error})`);
        if (result.error === 'invalid') return;
        const message = await items.snapshot();
        if (message) client.send(CHANNEL_EVENTS.items, message);
      })
      .catch((err: unknown) => {
        log(`channel: verdict handling failed (${errorMessage(err)})`);
      });
  });

  const stopRelay = startOutboxRelay(
    path.join(opts.root, '.passback', 'outbox'),
    (event) => {
      server.ws.send(CHANNEL_EVENTS.status, event);
      items.schedule();
    },
    { log },
  );

  let stopped = false;
  function stop(): void {
    if (stopped) return;
    stopped = true;
    stopRelay();
    items.stop();
  }

  server.httpServer?.once('close', stop);

  return stop;
}
