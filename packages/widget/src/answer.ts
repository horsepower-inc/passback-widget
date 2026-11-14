import { sendAnswer, type Hot } from './channel';

export type AnswerPort = { send(markId: string, text: string): Promise<boolean> };

export const ANSWER_WAIT_MS = 5000;

/** Present only when the integration lists the answer capability. */
export function createAnswer(opts: {
  hot: Hot | undefined;
  caps: unknown;
  waitMs?: number;
}): AnswerPort | undefined {
  const { hot, caps } = opts;
  if (!hot || !Array.isArray(caps) || !caps.includes('answer')) return undefined;
  const waitMs = opts.waitMs ?? ANSWER_WAIT_MS;
  const pending = new Map<string, (taken: boolean) => void>();

  return {
    send(markId: string, text: string): Promise<boolean> {
      pending.get(markId)?.(false);
      return new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (taken: boolean): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            hot.off?.('passback:status', listener);
          } catch {
            // the overlay never throws into the host page
          }
          if (pending.get(markId) === settle) pending.delete(markId);
          resolve(taken);
        };
        const listener = (data: unknown): void => {
          if (settled) return;
          const status = data as { markId?: unknown; state?: unknown } | null | undefined;
          if (status?.markId === markId && status.state === 'running') settle(true);
        };
        const timer = setTimeout(() => settle(false), waitMs);
        pending.set(markId, settle);
        try {
          hot.on('passback:status', listener);
        } catch {
          settle(false);
          return;
        }
        if (!sendAnswer(hot, markId, text)) settle(false);
      });
    },
  };
}

export function answerOf(win: Window & typeof globalThis): AnswerPort | undefined {
  const bridge = (win as unknown as { __passback?: { hot?: Hot; caps?: unknown } }).__passback;
  return createAnswer({ hot: bridge?.hot, caps: bridge?.caps });
}
