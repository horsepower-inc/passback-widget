import type { Hot } from './channel';

export type Verdict = 'accept' | 'withdraw' | 'park' | 'unpark';
export type VerdictPort = {
  accept(id: string): boolean;
  acceptAll(ids: readonly string[]): number;
  withdraw(id: string): boolean;
  park(id: string): boolean;
  unpark(id: string): boolean;
};

/** Asks the plugin to apply a verdict to a mark. Never throws into the host page. */
export function sendVerdict(
  hot: Pick<Hot, 'send'> | undefined,
  markId: string,
  verdict: Verdict,
): boolean {
  if (!hot) return false;
  try {
    hot.send('passback:verdict', { v: 1, markId, verdict });
    return true;
  } catch {
    return false;
  }
}

/** Present only when the integration lists the verdict capability. */
export function createVerdictPort(opts: {
  hot: Hot | undefined;
  caps: unknown;
}): VerdictPort | undefined {
  const { hot, caps } = opts;
  if (!hot || !Array.isArray(caps) || !caps.includes('verdict')) return undefined;
  const accept = (id: string): boolean => sendVerdict(hot, id, 'accept');
  return {
    accept,
    acceptAll: (ids) => ids.reduce((sent, id) => sent + (accept(id) ? 1 : 0), 0),
    withdraw: (id) => sendVerdict(hot, id, 'withdraw'),
    park: (id) => sendVerdict(hot, id, 'park'),
    unpark: (id) => sendVerdict(hot, id, 'unpark'),
  };
}

export function verdictOf(win: Window): VerdictPort | undefined {
  const bridge = (win as unknown as { __passback?: { hot?: Hot; caps?: unknown } }).__passback;
  return createVerdictPort({ hot: bridge?.hot, caps: bridge?.caps });
}
