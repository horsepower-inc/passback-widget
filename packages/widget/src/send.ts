import type { Batch, ChannelAck, ChannelMark, Payload } from '@passback/schema';
import { trimPayload } from '@passback/collectors';
import { newUlid } from './ulid';

export const NO_ANSWER = 'the server did not answer.';
export const REFUSED = 'the server refused it.';
export const TOO_LARGE = 'the comment is too large.';
export const NO_DESTINATION = 'this site has no destination yet.';
export const PAUSED = 'this site is paused.';

// Mirrors MAX_BATCH_MARKS in @passback/schema (the widget imports only types from it).
const MAX_BATCH_MARKS = 20;

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

export type BatchSendResult =
  | { ok: true; ids: string[]; trimmed: boolean[] }
  | { ok: false; reason: 'rejected' | 'network'; message: string };

export type SendMarksInput = Omit<SendMarkInput, 'payload'> & { payloads: readonly Payload[] };

/** Reads an ack for a batch of as many marks as `localTrimmed` has entries: one id per mark, entry i is mark i. */
export function readBatchAck(
  ack: ChannelAck,
  localTrimmed: readonly boolean[],
): { ok: true; ids: string[]; trimmed: boolean[] } | undefined {
  // A body without a trimmed list is not an ack.
  const ok = !ack.error && ack.accepted.length === localTrimmed.length;
  if (!ok || !Array.isArray(ack.trimmed)) return undefined;
  const ids = ack.accepted;
  return {
    ok: true,
    ids,
    trimmed: ids.map((id, i) => localTrimmed[i] || ack.trimmed.includes(id)),
  };
}

export type TrimmedMarks = { payloads: Payload[]; trimmed: boolean[] };

export function trimAll(input: readonly Payload[]): TrimmedMarks | undefined {
  if (input.length === 0 || input.length > MAX_BATCH_MARKS) return undefined;
  const payloads: Payload[] = [];
  const trimmed: boolean[] = [];
  for (const payload of input) {
    const r = trimPayload(payload);
    if (!r.fits) return undefined;
    payloads.push(r.payload);
    trimmed.push(r.trimmed.length > 0);
  }
  return { payloads, trimmed };
}

export function newBatch(marks: Payload[], o: { newId?: () => string; now?: () => Date }): Batch {
  return {
    schemaVersion: 1,
    id: (o.newId ?? newUlid)(),
    createdAt: (o.now ?? (() => new Date()))().toISOString(),
    marks,
  };
}

type Failure = { ok: false; reason: 'rejected' | 'network'; message: string };

/** POSTs the trimmed payloads as one ChannelMark batch and hands a 2xx ack to `read`. Never throws. */
async function postBatch<R>(
  input: Omit<SendMarkInput, 'payload'>,
  payloads: Payload[],
  read: (ack: ChannelAck) => R | undefined,
): Promise<R | Failure> {
  const mark: ChannelMark = {
    v: 1,
    batch: {
      ...newBatch(payloads, input),
      ...(payloads.length > 1 ? { filing: 'one' as const } : {}),
      ...(typeof input.pullRequest === 'number' ? { pullRequest: input.pullRequest } : {}),
    },
  };
  const stringified = stringifyMark(mark);
  if (!stringified.ok) return stringified;

  let response: Response;
  try {
    response = await (input.fetchFn ?? globalThis.fetch)(input.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stringified.body,
    });
  } catch {
    return { ok: false, reason: 'network', message: NO_ANSWER };
  }

  const ack = response.ok ? await readAck(response) : undefined;
  return (
    (ack && read(ack)) ?? {
      ok: false,
      reason: 'rejected',
      message: failureMessage(response.status),
    }
  );
}

/** Trims every Payload, POSTs them as one ChannelMark batch (flagged filing one when N > 1), and reports the ack. Never throws. */
export async function sendMarks(input: SendMarksInput): Promise<BatchSendResult> {
  const marks = trimAll(input.payloads);
  if (!marks) return { ok: false, reason: 'rejected', message: TOO_LARGE };
  return postBatch(input, marks.payloads, (ack) => readBatchAck(ack, marks.trimmed));
}

/** Maps the result of a batch of one to a SendResult. */
export function single(result: BatchSendResult): SendResult {
  return result.ok
    ? { ok: true, id: result.ids[0] ?? '', trimmed: result.trimmed[0] ?? false }
    : result;
}

/** Trims one Payload to fit, POSTs it as a ChannelMark batch of one, and reports the ack. Never throws. */
export async function sendMark(input: SendMarkInput): Promise<SendResult> {
  const marks = trimAll([input.payload]);
  if (!marks) return { ok: false, reason: 'rejected', message: TOO_LARGE };
  // The first accepted id is the mark's; only local trimming sets `trimmed`, as before batches.
  return postBatch(input, marks.payloads, (ack): SendResult | undefined => {
    const id = ack.accepted[0];
    return !ack.error && id ? { ok: true, id, trimmed: marks.trimmed[0] ?? false } : undefined;
  });
}
