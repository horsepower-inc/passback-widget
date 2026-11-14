// The HMR surface: turn an unknown passback:mark payload into inbox
// files and a ChannelAck, keeping the invariants (trimmed ⊆ accepted; accepted empty on error)
// without ever throwing back into the caller.

import { ChannelMark } from '@passback/schema';
import type { Batch, ChannelAck, Payload } from '@passback/schema';
import { FileInboxAdapter } from './file-inbox-adapter';
import type { Ref, TrackerAdapter } from './tracker-adapter';

const NIL_BATCH_ID = '00000000000000000000000000';
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const MAX_MARK_BYTES = 50 * 1024;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function markBytes(mark: Payload): number {
  return Buffer.byteLength(JSON.stringify(mark), 'utf8');
}

/** Reads `.batch.id` off unknown input without validating it, so a 400 can still echo the id
 * the caller sent. Only a well-formed ULID is echoed, so the ack itself never fails ChannelAck's
 * own schema. Never throws, even if `input` has a getter that does. */
function readableBatchId(input: unknown): string {
  try {
    if (input === null || typeof input !== 'object') return NIL_BATCH_ID;
    const batch = (input as { batch?: unknown }).batch;
    if (batch === null || typeof batch !== 'object') return NIL_BATCH_ID;
    const id = (batch as { id?: unknown }).id;
    return typeof id === 'string' && ULID_RE.test(id) ? id : NIL_BATCH_ID;
  } catch {
    return NIL_BATCH_ID;
  }
}

async function writeBatch(adapter: TrackerAdapter, batch: Batch): Promise<string[]> {
  if (batch.marks.length === 1) {
    // A batch of one never creates a parent: most TrackerAdapters
    // would treat `opts.parent` as a real tracker reference and reject one that was never
    // returned by createParent. FileInboxAdapter is the one exception — it reads the batchId
    // it writes to the inbox file (§2) off `opts.parent.id` rather than validating it as a
    // tracker object, so only it gets the batch's own id passed through this way.
    const opts = adapter instanceof FileInboxAdapter ? { parent: { id: batch.id } } : undefined;
    const ref = await adapter.createIssue(batch.marks[0] as Payload, opts);
    return [ref.id];
  }
  const parent: Ref = await adapter.createParent(batch);
  const accepted: string[] = [];
  for (const mark of batch.marks) {
    const ref = await adapter.createIssue(mark, { parent });
    accepted.push(ref.id);
  }
  return accepted;
}

/** Turns an unknown `passback:mark` payload into inbox files (via `adapter`) and a
 * `passback:ack`. Never throws or rejects, whatever `input` is. */
export async function acceptMark(adapter: TrackerAdapter, input: unknown): Promise<ChannelAck> {
  let parsed: ReturnType<typeof ChannelMark.safeParse>;
  try {
    parsed = ChannelMark.safeParse(input);
  } catch (err) {
    return {
      v: 1,
      batchId: readableBatchId(input),
      accepted: [],
      trimmed: [],
      error: { code: 'bad_request', message: errorMessage(err) },
    };
  }

  if (!parsed.success) {
    return {
      v: 1,
      batchId: readableBatchId(input),
      accepted: [],
      trimmed: [],
      error: { code: 'bad_request', message: parsed.error.message },
    };
  }

  const { batch } = parsed.data;
  const oversized = batch.marks.some((mark) => markBytes(mark) > MAX_MARK_BYTES);
  if (oversized) {
    return {
      v: 1,
      batchId: batch.id,
      accepted: [],
      trimmed: [],
      error: { code: 'payload_too_large', message: `a mark exceeds ${MAX_MARK_BYTES} bytes` },
    };
  }

  try {
    const accepted = await writeBatch(adapter, batch);
    return { v: 1, batchId: batch.id, accepted, trimmed: [] };
  } catch (err) {
    return {
      v: 1,
      batchId: batch.id,
      accepted: [],
      trimmed: [],
      error: { code: 'write_failed', message: errorMessage(err) },
    };
  }
}
