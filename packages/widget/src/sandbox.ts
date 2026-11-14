import type { ChannelAck, ChannelStatus } from '@passback/schema';
import type { Hot } from './channel';
import { newUlid } from './ulid';

export type SandboxMessages = { queued: string; running: string; done: string };

export type SandboxOptions = {
  setTimer?: (run: () => void, ms: number) => unknown;
  now?: () => Date;
  newId?: () => string;
  queuedAfterMs?: number;
  runningAfterMs?: number;
  doneAfterMs?: number;
  messages?: Partial<SandboxMessages>;
};

export const SANDBOX_MESSAGES: SandboxMessages = {
  queued: 'Sent. Waiting for the agent.',
  running: 'The agent is working on it.',
  done: 'Fixed. This is a demo, so nothing was really sent.',
};

type Listener = (data: unknown) => void;

type Parsed = { batchId: string; count: number };

function parseBatch(data: unknown): Parsed {
  const batch = (data as { batch?: { id?: unknown; marks?: unknown } } | null | undefined)?.batch;
  const batchId = typeof batch?.id === 'string' ? batch.id : '';
  const marks = batch?.marks;
  const ok = (data as { v?: unknown } | null | undefined)?.v === 1 && typeof batch?.id === 'string';
  return { batchId, count: ok && Array.isArray(marks) ? marks.length : 0 };
}

function makeListeners() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    on(event: string, cb: Listener): void {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(cb);
    },
    off(event: string, cb: Listener): void {
      listeners.get(event)?.delete(cb);
    },
    emit(event: string, data: unknown): void {
      for (const cb of [...(listeners.get(event) ?? [])]) {
        try {
          cb(data);
        } catch {
          // a broken listener never stops the others or reaches the host page
        }
      }
    },
  };
}

/** A stand-in for the plugin's end of the HMR channel that answers inside the page and sends nothing. */
export function createSandboxHot(options: SandboxOptions = {}): Hot {
  const setTimer = options.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => newUlid());
  const delays = {
    queued: options.queuedAfterMs ?? 50,
    running: options.runningAfterMs ?? 1100,
    done: options.doneAfterMs ?? 2600,
  };
  const messages: SandboxMessages = { ...SANDBOX_MESSAGES, ...options.messages };
  const { on, off, emit } = makeListeners();

  function ack(body: Omit<ChannelAck, 'v'>): void {
    setTimer(() => emit('passback:ack', { v: 1, ...body }), 0);
  }

  function play(ids: string[], state: keyof SandboxMessages): void {
    setTimer(() => {
      for (const markId of ids) {
        const status: ChannelStatus = {
          v: 1,
          markId,
          state,
          message: messages[state],
          at: now().toISOString(),
        };
        emit('passback:status', status);
      }
    }, delays[state]);
  }

  function send(event: string, data: unknown): void {
    if (event !== 'passback:mark') return;
    const { batchId, count } = parseBatch(data);
    if (count === 0) {
      const error = { code: 'sandbox_invalid', message: 'not a mark batch' };
      ack({ batchId, accepted: [], trimmed: [], error } as Omit<ChannelAck, 'v'>);
      return;
    }
    const ids = Array.from({ length: count }, () => newId());
    ack({ batchId, accepted: ids, trimmed: [] } as Omit<ChannelAck, 'v'>);
    play(ids, 'queued');
    play(ids, 'running');
    play(ids, 'done');
  }

  return { on, off, send };
}
