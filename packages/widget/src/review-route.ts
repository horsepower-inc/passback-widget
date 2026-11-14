import type { Payload } from '@passback/schema';
import type { ReviewClient } from './review-session';

export type ReviewRoute = (payloads: readonly Payload[]) => ReturnType<ReviewClient['send']>;

const CLOSED: Record<string, string> = {
  review_finished: 'This round has closed.',
  review_expired: 'This review link has expired. Take the new link from your team.',
};

/**
 * What a comment's own error says once the round is over; such a comment is never filed elsewhere.
 * A single comment shows no list row while it waits, so its own words follow, quoted.
 */
export function closedMessage(code: string | undefined, text?: string): string | undefined {
  const words = code !== undefined && Object.hasOwn(CLOSED, code) ? CLOSED[code] : undefined;
  return words && text ? `${words} “${text}”` : words;
}

// What is being sent, by identity: one comment's own detail, or the marks of a kept list. The same words are not the same submission.
function submissionOf(event: Event): object[] {
  const detail = (event as CustomEvent<object & { details?: { mark?: object }[] }>).detail;
  return detail.details ? detail.details.flatMap(({ mark }) => mark ?? []) : [detail];
}

/** The send path of a session: a failed submission keeps its batch id for its own retry, so that retry does not save it twice. */
export function routeOf(client: ReviewClient, host: HTMLElement) {
  const failed = new WeakMap<object, { list: object[]; batchId: string }>();
  let current: object[] = [];
  const watch = (event: Event): void => void (current = submissionOf(event));
  const route: ReviewRoute = async (payloads) => {
    const list = current;
    const [first] = list;
    const kept = first && failed.get(first);
    const same = kept?.list.length === list.length && list.every((m, i) => m === kept?.list[i]);
    const sent = await client.send(payloads, same ? kept?.batchId : undefined);
    if (first && sent.ok) failed.delete(first);
    if (sent.ok) return sent;
    if (first) failed.set(first, { list, batchId: sent.batchId });
    const single = first && !('dot' in first) ? (first as { comment?: string }).comment : undefined;
    const closed = closedMessage(sent.code, single);
    return closed ? { ...sent, message: closed } : sent;
  };
  const events = ['passback:submit', 'passback:submit-all'];
  events.forEach((type) => host.addEventListener(type, watch));
  return {
    route,
    unwatch: () => events.forEach((type) => host.removeEventListener(type, watch)),
    /** Names the submission the next send carries, for one that comes from no overlay event (the panel's Add detail). */
    name: (submission: object): void => void (current = [submission]),
  };
}
