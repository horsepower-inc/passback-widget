import type { Batch, ChannelAck, ChannelMark, Payload } from '@passback/schema';
import { payloadBytes, trimPayload } from '@passback/collectors';
import { newUlid } from './ulid';

export const NO_ANSWER = 'the server did not answer.';
export const REFUSED = 'the server refused it.';
export const ALREADY_THERE = 'the server already has it.';
export const TOO_LARGE = 'the comment is too large.';
export const NO_DESTINATION = 'this site has no destination yet.';
export const PAUSED = 'this site is paused.';

/** How long one relay send may take, request and answer body together. */
export const SEND_TIMEOUT_MS = 20_000;

// Mirrors MAX_BATCH_MARKS in @passback/schema (the widget imports only types from it).
const MAX_BATCH_MARKS = 20;

// Mirrors http.maxBodyBytes in apps/api/src/core/config.ts: the relay answers 413 to a larger request body.
const MAX_REQUEST_BYTES = 65_536;

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

/**
 * Trims every mark to its own budget. Given the bytes of the request around the marks (the body with an empty
 * `marks` list), it also trims until the whole request fits the relay's limit.
 */
export function trimAll(
  input: readonly Payload[],
  envelopeBytes?: number,
): TrimmedMarks | undefined {
  if (input.length === 0 || input.length > MAX_BATCH_MARKS) return undefined;
  const payloads: Payload[] = [];
  const trimmed: boolean[] = [];
  for (const payload of input) {
    const r = trimPayload(payload);
    if (!r.fits) return undefined;
    payloads.push(r.payload);
    trimmed.push(r.trimmed.length > 0);
  }
  const marks = { payloads, trimmed };
  return envelopeBytes === undefined ? marks : fitRequest(marks, envelopeBytes);
}

/** Trims the largest mark not yet trimmed to just what the request needs, until it fits; undefined when it cannot. */
function fitRequest(marks: TrimmedMarks, envelopeBytes: number): TrimmedMarks | undefined {
  const { payloads, trimmed } = marks;
  const sizes = payloads.map(payloadBytes);
  const tried = new Set<number>();
  for (;;) {
    // The marks sit in the envelope's empty list, one comma between each two.
    const over =
      envelopeBytes + sizes.reduce((a, b) => a + b, 0) + sizes.length - 1 - MAX_REQUEST_BYTES;
    if (over <= 0) return marks;
    let i = -1;
    sizes.forEach((size, j) => {
      if (!tried.has(j) && (i < 0 || size > (sizes[i] ?? 0))) i = j;
    });
    if (i < 0) return undefined;
    tried.add(i);
    // A budget it cannot meet trims the mark as far as it goes; the next largest mark covers the rest.
    const r = trimPayload(payloads[i] as Payload, (sizes[i] ?? 0) - over);
    payloads[i] = r.payload;
    sizes[i] = payloadBytes(r.payload);
    trimmed[i] = (trimmed[i] ?? false) || r.trimmed.length > 0;
  }
}

/** Trims the payloads to fit the request around the empty `envelope`, puts them in it and serializes the request. */
function fitBatch(
  payloads: readonly Payload[],
  envelope: Batch,
): { ok: true; body: string; trimmed: boolean[] } | Failure {
  const mark: ChannelMark = { v: 1, batch: envelope };
  // Bytes as the relay counts them.
  const marks = trimAll(payloads, new TextEncoder().encode(JSON.stringify(mark)).length);
  if (!marks) return { ok: false, reason: 'rejected', message: TOO_LARGE };
  envelope.marks = marks.payloads;
  const stringified = stringifyMark(mark);
  return stringified.ok ? { ...stringified, trimmed: marks.trimmed } : stringified;
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

/** Trims the payloads to fit the request, POSTs them as one ChannelMark batch and hands a 2xx ack to `read`. Never throws. */
async function postBatch<R>(
  input: Omit<SendMarkInput, 'payload'>,
  payloads: readonly Payload[],
  read: (ack: ChannelAck, trimmed: boolean[]) => R | undefined,
): Promise<R | Failure> {
  const stringified = fitBatch(payloads, {
    ...newBatch([], input),
    ...(payloads.length > 1 ? { filing: 'one' as const } : {}),
    ...(typeof input.pullRequest === 'number' ? { pullRequest: input.pullRequest } : {}),
  });
  if (!stringified.ok) return stringified;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Failure>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: 'network', message: NO_ANSWER });
    }, SEND_TIMEOUT_MS);
  });
  const post = async (): Promise<R | Failure> => {
    let response: Response;
    try {
      response = await (input.fetchFn ?? globalThis.fetch)(input.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: stringified.body,
        signal: controller.signal,
      });
    } catch {
      return { ok: false, reason: 'network', message: NO_ANSWER };
    }
    const ack = response.ok ? await readAck(response) : undefined;
    if (controller.signal.aborted) return { ok: false, reason: 'network', message: NO_ANSWER };
    if (ack?.error?.code === 'duplicate') {
      return { ok: false, reason: 'rejected', message: ALREADY_THERE };
    }
    return (
      (ack && read(ack, stringified.trimmed)) ?? {
        ok: false,
        reason: 'rejected',
        message: failureMessage(response.status),
      }
    );
  };
  try {
    return await Promise.race([post(), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** Trims every Payload, POSTs them as one ChannelMark batch (flagged filing one when N > 1), and reports the ack. Never throws. */
export async function sendMarks(input: SendMarksInput): Promise<BatchSendResult> {
  return postBatch(input, input.payloads, readBatchAck);
}

export type ReviewFailure = Failure & { status?: number; code?: string; comments?: string[] };
export type ReviewSendResult = { ok: true; ids: string[]; trimmed: boolean[] } | ReviewFailure;

/** The POST every review request shares; the id travels in the body, never in the URL. */
export function postReview(fetchFn: typeof fetch | undefined, url: string, body: string) {
  return (fetchFn ?? globalThis.fetch)(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'omit',
    body,
  });
}

/** A refused review request as the caller needs it: the code and any held comment ids. Never throws. */
export async function reviewFailure(response: Response): Promise<ReviewFailure> {
  const { status } = response;
  const body: { code?: unknown; comments?: unknown } | null = await response
    .json()
    .catch(() => null);
  const code = body?.code;
  const comments = body?.comments;
  return {
    ok: false,
    reason: 'rejected',
    message: failureMessage(status),
    status,
    ...(typeof code === 'string' ? { code } : {}),
    ...(Array.isArray(comments)
      ? { comments: comments.filter((id): id is string => typeof id === 'string') }
      : {}),
  };
}

// Apart from postBatch on purpose: nothing in the core calls this, so the relay core stays the same size.
/** Sends one review batch: each mark becomes a comment, so there is no filing and no pull request. Never throws. */
export async function sendReviewMarks(
  input: Omit<SendMarksInput, 'pullRequest'> & { review: string },
): Promise<ReviewSendResult> {
  const stringified = fitBatch(input.payloads, { ...newBatch([], input), review: input.review });
  if (!stringified.ok) return stringified;
  let response: Response;
  try {
    response = await postReview(input.fetchFn, input.endpoint, stringified.body);
  } catch {
    return { ok: false, reason: 'network', message: NO_ANSWER };
  }
  if (response.status !== 202) return reviewFailure(response);
  const ack = await readAck(response);
  return (
    (ack && readBatchAck(ack, stringified.trimmed)) ?? {
      ok: false,
      reason: 'rejected',
      message: REFUSED,
    }
  );
}

/** Maps the result of a batch of one to a SendResult. */
export function single(result: BatchSendResult): SendResult {
  return result.ok
    ? { ok: true, id: result.ids[0] ?? '', trimmed: result.trimmed[0] ?? false }
    : result;
}

/** Trims one Payload to fit, POSTs it as a ChannelMark batch of one, and reports the ack. Never throws. */
export async function sendMark(input: SendMarkInput): Promise<SendResult> {
  // The first accepted id is the mark's; only local trimming sets `trimmed`, as before batches.
  return postBatch(input, [input.payload], (ack, trimmed): SendResult | undefined => {
    const id = ack.accepted[0];
    return !ack.error && id ? { ok: true, id, trimmed: trimmed[0] ?? false } : undefined;
  });
}
