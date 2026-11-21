/** Reads the relay's seen answer from `window.__passback.relay` (published by `pingSeen`) and
 *  names the tracker when filing to it is offered: the subscription is active and a tracker is
 *  named. Every other answer, a missing or throwing getter included, gives `undefined`. */
export function trackerOffer(win: Window): string | undefined {
  try {
    const scope = (win as unknown as { __passback?: { relay?: unknown } }).__passback;
    if (typeof scope?.relay !== 'function') return undefined;
    const body: unknown = scope.relay();
    if (typeof body !== 'object' || body === null) return undefined;
    const { subscription, tracker } = body as { subscription?: unknown; tracker?: unknown };
    return subscription === 'active' && typeof tracker === 'string' && tracker !== ''
      ? tracker
      : undefined;
  } catch {
    return undefined;
  }
}
