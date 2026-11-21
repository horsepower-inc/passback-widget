import { sendReopen, type Hot } from './channel';

export type ReopenPort = { send(markId: string, comment: string): Promise<boolean> };

export const REOPEN_WAIT_MS = 5000;

/** Present only when the integration lists the reopen capability. */
export function createReopen(opts: {
  hot: Hot | undefined;
  caps: unknown;
  waitMs?: number;
}): ReopenPort | undefined {
  const { hot, caps } = opts;
  if (!hot || !Array.isArray(caps) || !caps.includes('reopen')) return undefined;
  const waitMs = opts.waitMs ?? REOPEN_WAIT_MS;
  const pending = new Map<string, (queued: boolean) => void>();

  return {
    send(markId: string, comment: string): Promise<boolean> {
      pending.get(markId)?.(false);
      return new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (queued: boolean): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            hot.off?.('passback:status', listener);
          } catch {
            // the overlay never throws into the host page
          }
          if (pending.get(markId) === settle) pending.delete(markId);
          resolve(queued);
        };
        const listener = (data: unknown): void => {
          if (settled) return;
          const status = data as { markId?: unknown; state?: unknown } | null | undefined;
          if (status?.markId === markId && status.state === 'queued') settle(true);
        };
        const timer = setTimeout(() => settle(false), waitMs);
        pending.set(markId, settle);
        try {
          hot.on('passback:status', listener);
        } catch {
          settle(false);
          return;
        }
        if (!sendReopen(hot, markId, comment)) {
          settle(false);
        }
      });
    },
  };
}

export function reopenOf(win: Window & typeof globalThis): ReopenPort | undefined {
  const bridge = (win as unknown as { __passback?: { hot?: Hot; caps?: unknown } }).__passback;
  return createReopen({ hot: bridge?.hot, caps: bridge?.caps });
}
