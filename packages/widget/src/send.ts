import type { ChannelAck, ChannelMark, Payload } from '@passback/schema';
import { trimPayload } from '@passback/collectors';
import { newUlid } from './ulid';

export const NO_ANSWER = 'the server did not answer.';
export const REFUSED = 'the server refused it.';
export const TOO_LARGE = 'the comment is too large.';
export const NO_DESTINATION = 'this site has no destination yet.';
export const PAUSED = 'this site is paused.';

export type SendResult =
  | { ok: true; id: string; trimmed: boolean }
  | { ok: false; reason: 'rejected' | 'network'; message: string };

export type SendMarkInput = {
  payload: Payload;
  endpoint: string;
  fetchFn?: typeof fetch;
  now?: () => Date;
  newId?: () => string;
  pullRequest?: number;
};

function isChannelAck(body: unknown): body is ChannelAck {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { accepted?: unknown }).accepted) &&
    (body as { accepted: unknown[] }).accepted.every((id) => typeof id === 'string')
  );
}

async function readAck(response: Response): Promise<ChannelAck | undefined> {
  try {
    const body: unknown = await response.json();
    return isChannelAck(body) ? body : undefined;
  } catch {
    return undefined;
  }
}

type PostResult =
  { ok: true; id: string } | { ok: false; reason: 'rejected' | 'network'; message: string };

function stringifyMark(
  mark: ChannelMark,
): { ok: true; body: string } | { ok: false; reason: 'rejected'; message: string } {
  try {
    return { ok: true, body: JSON.stringify(mark) };
  } catch (err) {
    return {
      ok: false,
      reason: 'rejected',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function failureMessage(status: number): string {
  if (status === 413) {
    return TOO_LARGE;
  }
  if (status === 409) {
    return NO_DESTINATION;
  }
  if (status === 402) {
    return PAUSED;
  }
  return status >= 500 && status <= 599 ? NO_ANSWER : REFUSED;
}

function interpretAck(response: Response, ack: ChannelAck | undefined): PostResult {
  const acceptedId = ack?.accepted[0];
  if (!response.ok || !ack || ack.error || !acceptedId) {
    return { ok: false, reason: 'rejected', message: failureMessage(response.status) };
  }
  return { ok: true, id: acceptedId };
}

/** POSTs a ChannelMark and interprets the ChannelAck. Never throws. */
async function postMark(
  fetchFn: typeof fetch,
  endpoint: string,
  mark: ChannelMark,
): Promise<PostResult> {
  const stringified = stringifyMark(mark);
  if (!stringified.ok) {
    return stringified;
  }

  let response: Response;
  try {
    response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stringified.body,
    });
  } catch {
    return { ok: false, reason: 'network', message: NO_ANSWER };
  }

  return interpretAck(response, await readAck(response));
}

/** Trims one Payload to fit, POSTs it as a ChannelMark batch of one, and reports the ack. Never throws. */
export async function sendMark(input: SendMarkInput): Promise<SendResult> {
  const fetchFn = input.fetchFn ?? globalThis.fetch;
  const now = input.now ?? (() => new Date());
  const newId = input.newId ?? newUlid;

  const trimResult = trimPayload(input.payload);
  if (!trimResult.fits) {
    return { ok: false, reason: 'rejected', message: TOO_LARGE };
  }

  const mark: ChannelMark = {
    v: 1,
    batch: {
      schemaVersion: 1,
      id: newId(),
      createdAt: now().toISOString(),
      marks: [trimResult.payload],
      ...(typeof input.pullRequest === 'number' ? { pullRequest: input.pullRequest } : {}),
    },
  };

  const result = await postMark(fetchFn, input.endpoint, mark);
  return result.ok ? { ...result, trimmed: trimResult.trimmed.length > 0 } : result;
}
