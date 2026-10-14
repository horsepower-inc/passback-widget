import type { Batch, ChannelAck, ChannelStatus, Payload } from '@passback/schema';
import { trimPayload } from '@passback/collectors';
import { createChannel, type Hot } from './channel';
import { NO_ANSWER, REFUSED, TOO_LARGE, sendMark, type SendResult } from './send';
import { newUlid } from './ulid';

export type CreateTransportOptions = {
  hot?: Hot;
  endpoint: string;
  onStatus(status: ChannelStatus): void;
  fetchFn?: typeof fetch;
  now?: () => Date;
  newId?: () => string;
  ackTimeoutMs?: number;
  pullRequest?: () => number | undefined;
};

export type Transport = {
  send(payload: Payload): Promise<SendResult>;
  dispose(): void;
};

const DEFAULT_ACK_TIMEOUT_MS = 5000;

type Pending = {
  settle(result: SendResult): void;
  trimmed: boolean;
  timer: ReturnType<typeof setTimeout>;
};

function buildBatch(
  payload: Payload,
  newId: () => string,
  now: () => Date,
): { batch: Batch; trimmed: boolean } | undefined {
  const trimResult = trimPayload(payload);
  if (!trimResult.fits) return undefined;
  return {
    batch: {
      schemaVersion: 1,
      id: newId(),
      createdAt: now().toISOString(),
      marks: [trimResult.payload],
    },
    trimmed: trimResult.trimmed.length > 0,
  };
}

type PendingRegistry = {
  register(batchId: string, entry: Pending): void;
  settle(batchId: string, result: SendResult): void;
  onAck(ack: ChannelAck): void;
  settleAll(message: string): void;
};

function createPendingRegistry(): PendingRegistry {
  const pending = new Map<string, Pending>();

  function settle(batchId: string, result: SendResult): void {
    const entry = pending.get(batchId);
    if (!entry) return;
    pending.delete(batchId);
    clearTimeout(entry.timer);
    entry.settle(result);
  }

  return {
    register(batchId, entry) {
      pending.set(batchId, entry);
    },
    settle,
    onAck(ack: ChannelAck): void {
      const acceptedId = ack.accepted[0];
      if (ack.error || !acceptedId) {
        settle(ack.batchId, {
          ok: false,
          reason: 'rejected',
          message: REFUSED,
        });
        return;
      }
      const entry = pending.get(ack.batchId);
      if (!entry) return;
      settle(ack.batchId, {
        ok: true,
        id: acceptedId,
        trimmed: entry.trimmed || ack.trimmed.includes(acceptedId),
      });
    },
    settleAll(message: string): void {
      for (const batchId of [...pending.keys()]) {
        settle(batchId, { ok: false, reason: 'network', message });
      }
    },
  };
}

type AckSend = {
  registry: PendingRegistry;
  channel: ReturnType<typeof createChannel>;
  batch: Batch;
  trimmed: boolean;
  ackTimeoutMs: number;
};

function sendAndAwaitAck(args: AckSend): Promise<SendResult> {
  const { registry, channel, batch, trimmed, ackTimeoutMs } = args;
  return new Promise<SendResult>((resolve) => {
    const timer = setTimeout(
      () => registry.settle(batch.id, { ok: false, reason: 'network', message: NO_ANSWER }),
      ackTimeoutMs,
    );
    registry.register(batch.id, { settle: resolve, trimmed, timer });

    let sent: boolean;
    try {
      sent = channel.sendMark(batch);
    } catch {
      sent = false;
    }
    if (!sent) registry.settle(batch.id, { ok: false, reason: 'network', message: NO_ANSWER });
  });
}

function createHotTransport(hot: Hot, opts: CreateTransportOptions): Transport {
  const now = opts.now ?? (() => new Date());
  const newId = opts.newId ?? newUlid;
  const ackTimeoutMs = opts.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;

  const registry = createPendingRegistry();
  let disposed = false;

  const channel = createChannel(hot, { onAck: registry.onAck, onStatus: opts.onStatus });

  function send(payload: Payload): Promise<SendResult> {
    let built: { batch: Batch; trimmed: boolean } | undefined;
    try {
      built = buildBatch(payload, newId, now);
    } catch (err) {
      return Promise.resolve({
        ok: false,
        reason: 'rejected',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    if (!built) {
      return Promise.resolve({
        ok: false,
        reason: 'rejected',
        message: TOO_LARGE,
      });
    }
    const { batch, trimmed } = built;

    return sendAndAwaitAck({ registry, channel, batch, trimmed, ackTimeoutMs });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    channel.dispose();
    registry.settleAll('transport disposed');
  }

  return { send, dispose };
}

function createPostTransport(opts: CreateTransportOptions): Transport {
  return {
    send(payload: Payload): Promise<SendResult> {
      return sendMark({
        payload,
        endpoint: opts.endpoint,
        fetchFn: opts.fetchFn,
        now: opts.now,
        newId: opts.newId,
        pullRequest: opts.pullRequest?.(),
      });
    },
    dispose(): void {},
  };
}

/** sends a mark over the HMR channel when there is one, otherwise POSTs it. Never throws. */
export function createTransport(opts: CreateTransportOptions): Transport {
  return opts.hot ? createHotTransport(opts.hot, opts) : createPostTransport(opts);
}
