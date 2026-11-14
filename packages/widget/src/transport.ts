import type { ChannelAck, ChannelStatus, Payload } from '@passback/schema';
import { createChannel, type Hot } from './channel';
import {
  NO_ANSWER,
  REFUSED,
  TOO_LARGE,
  readBatchAck,
  newBatch,
  sendMark,
  sendMarks,
  single,
  trimAll,
  type BatchSendResult,
  type SendResult,
} from './send';

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
  sendBatch(payloads: readonly Payload[]): Promise<BatchSendResult>;
  dispose(): void;
};

const DEFAULT_ACK_TIMEOUT_MS = 5000;

type Pending = {
  settle(result: BatchSendResult): void;
  trimmed: boolean[];
  timer: ReturnType<typeof setTimeout>;
};

type PendingRegistry = {
  register(batchId: string, entry: Pending): void;
  settle(batchId: string, result: BatchSendResult): void;
  onAck(ack: ChannelAck): void;
  settleAll(message: string): void;
};

function createPendingRegistry(): PendingRegistry {
  const pending = new Map<string, Pending>();

  function settle(batchId: string, result: BatchSendResult): void {
    const entry = pending.get(batchId);
    if (!entry) return;
    pending.delete(batchId);
    clearTimeout(entry.timer);
    entry.settle(result);
  }

  return {
    register: (batchId, entry) => void pending.set(batchId, entry),
    settle,
    onAck(ack: ChannelAck): void {
      const entry = pending.get(ack.batchId);
      if (entry) {
        settle(
          ack.batchId,
          readBatchAck(ack, entry.trimmed) ?? { ok: false, reason: 'rejected', message: REFUSED },
        );
      }
    },
    settleAll(message: string): void {
      pending.forEach((_, batchId) => settle(batchId, { ok: false, reason: 'network', message }));
    },
  };
}

function createHotTransport(hot: Hot, opts: CreateTransportOptions): Transport {
  const ackTimeoutMs = opts.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;

  const registry = createPendingRegistry();
  let disposed = false;

  const channel = createChannel(hot, { onAck: registry.onAck, onStatus: opts.onStatus });

  async function sendBatch(payloads: readonly Payload[]): Promise<BatchSendResult> {
    try {
      const marks = trimAll(payloads);
      if (!marks) return { ok: false, reason: 'rejected', message: TOO_LARGE };
      const batch = newBatch(marks.payloads, opts);
      return await new Promise<BatchSendResult>((resolve) => {
        const noAnswer = (): void =>
          registry.settle(batch.id, { ok: false, reason: 'network', message: NO_ANSWER });
        const timer = setTimeout(noAnswer, ackTimeoutMs);
        registry.register(batch.id, { settle: resolve, trimmed: marks.trimmed, timer });

        let sent: boolean;
        try {
          sent = channel.sendMark(batch);
        } catch {
          sent = false;
        }
        if (!sent) noAnswer();
      });
    } catch (err) {
      return {
        ok: false,
        reason: 'rejected',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    channel.dispose();
    registry.settleAll('transport disposed');
  }

  return { send: async (payload) => single(await sendBatch([payload])), sendBatch, dispose };
}

function createPostTransport(opts: CreateTransportOptions): Transport {
  return {
    send: (payload) => sendMark({ ...opts, payload, pullRequest: opts.pullRequest?.() }),
    sendBatch: (payloads) => sendMarks({ ...opts, payloads, pullRequest: opts.pullRequest?.() }),
    dispose(): void {},
  };
}

/** sends a mark over the HMR channel when there is one, otherwise POSTs it. Never throws. */
export function createTransport(opts: CreateTransportOptions): Transport {
  return opts.hot ? createHotTransport(opts.hot, opts) : createPostTransport(opts);
}
