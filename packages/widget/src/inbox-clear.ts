import type { Hot } from './channel';

// The clear wire of the Inbox panel, declared structurally: the widget never imports the schema for it.
export type ClearScope = 'fixed' | 'tracker' | 'workspace';
export type ClearRequest = { v: 1; scope: ClearScope; settings?: true };
export type ClearAnswer = {
  v: 1;
  scope: ClearScope;
  comments: number;
  attachments: number;
  answers: number;
  done: number;
  settings: boolean;
};
export type ClearRow = { status: string; sentToTracker?: unknown };
export type ClearCounts = { comments: number; fixed: number; tracker: number; working: number };
export type ClearPort = {
  send(request: ClearRequest): Promise<ClearAnswer | undefined>;
  /** Gives up waiting for the request in flight; its promise resolves undefined. */
  cancel(): void;
};

export const UNDO_MS = 5000;
export const CLEAR_WAIT_MS = 5000;

/** The selection rules of the adapter, so a count equals what the clear removes. */
export function clearCounts(rows: readonly ClearRow[]): ClearCounts {
  const count = (test: (row: ClearRow) => boolean): number => rows.filter(test).length;
  return {
    comments: rows.length,
    fixed: count((row) => row.status === 'accepted' || row.status === 'verified'),
    tracker: count((row) => row.sentToTracker !== undefined),
    working: count((row) => row.status === 'ack'),
  };
}

const count = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 0;

function answerOf(data: unknown, scope: ClearScope): ClearAnswer | undefined {
  const a = data as Partial<Record<keyof ClearAnswer, unknown>> | null | undefined;
  if (!a || typeof a !== 'object' || a.v !== 1 || a.scope !== scope) return undefined;
  if (![a.comments, a.attachments, a.answers, a.done].every(count)) return undefined;
  return { ...a, settings: a.settings === true } as ClearAnswer;
}

/** Present only when the integration lists the clear capability; never throws. */
export function createClearPort(opts: {
  hot: Hot | undefined;
  caps: unknown;
  waitMs?: number;
}): ClearPort | undefined {
  const { hot, caps } = opts;
  if (!hot || !Array.isArray(caps) || !caps.includes('clear')) return undefined;
  const waitMs = opts.waitMs ?? CLEAR_WAIT_MS;
  let current: ((answer: ClearAnswer | undefined) => void) | undefined;

  return {
    cancel: () => current?.(undefined),
    send(request) {
      current?.(undefined);
      return new Promise((resolve) => {
        let settled = false;
        const settle = (answer: ClearAnswer | undefined): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            hot.off?.('passback:cleared', listener);
          } catch {
            // the overlay never throws into the host page
          }
          if (current === settle) current = undefined;
          resolve(answer);
        };
        const listener = (data: unknown): void => {
          const answer = answerOf(data, request.scope);
          if (answer) settle(answer);
        };
        const timer = setTimeout(() => settle(undefined), waitMs);
        current = settle;
        try {
          hot.on('passback:cleared', listener);
          hot.send('passback:clear', request);
        } catch {
          settle(undefined);
        }
      });
    },
  };
}

export function clearOf(win: Window): ClearPort | undefined {
  try {
    const bridge = (win as unknown as { __passback?: { hot?: Hot; caps?: unknown } }).__passback;
    return createClearPort({ hot: bridge?.hot, caps: bridge?.caps });
  } catch {
    return undefined;
  }
}
