// the inbox file holds iterations.

import type { Annotation, ChannelStatus, Payload } from '@passback/schema';
import { resolveChain } from './resolve';
import { transition, type MarkStatus } from './status';

export type Verdict =
  { kind: 'accept' } | { kind: 'decline'; reason: string } | { kind: 'comment'; text: string };

/** One agent status message kept in an iteration's history (CONTRACTS.md §2). */
export type IterationStatus = Pick<ChannelStatus, 'state' | 'message' | 'prUrl' | 'at'>;

export type Iteration = {
  n: number;
  statuses?: IterationStatus[];
  agent?: { at: string; text: string };
  human?: { at: string; verdict: Verdict };
};

/** Where a comment was filed: the tracker's name, the issue reference and, if given, its link. */
export type SentToTracker = { tracker: string; ref: string; url?: string };

export type InboxFile = {
  id: string;
  schemaVersion: 1;
  batchId: string;
  category?: Payload['intent']['category'];
  status: MarkStatus;
  iteration: number;
  route: string;
  selector: string;
  file?: string;
  buildId?: string;
  createdAt: string;
  orphaned?: boolean;
  parked?: boolean;
  sentToTracker?: SentToTracker;
  wireframe?: true;
  comment: string;
  annotations: Annotation[];
  iterations: Iteration[];
};

/** The chain's first `file:line:col` for an entry that names a file, if any. */
function firstChainFile(chain: Payload['code']['chain']): string | undefined {
  const entry = chain.find((c) => c.file !== undefined);
  if (!entry?.file) return undefined;
  const parts = [entry.file, entry.line, entry.col].filter((p) => p !== undefined);
  return parts.join(':');
}

/** Builds a new inbox file from a mark payload, at iteration 1 with no history yet. */
export function fromPayload(
  payload: Payload,
  meta: { id: string; batchId: string; createdAt: string },
  ids?: Readonly<Record<string, string>>,
): InboxFile {
  const selector = payload.element.selectors[0]?.value ?? '';
  const file = firstChainFile(resolveChain(payload.code.chain, ids));
  return {
    id: meta.id,
    schemaVersion: 1,
    batchId: meta.batchId,
    ...(payload.intent.category !== undefined ? { category: payload.intent.category } : {}),
    status: 'new',
    iteration: 1,
    route: payload.runtime.route,
    selector,
    ...(file !== undefined ? { file } : {}),
    ...(payload.code.buildId !== undefined ? { buildId: payload.code.buildId } : {}),
    createdAt: meta.createdAt,
    comment: payload.intent.comment,
    annotations: payload.intent.annotations,
    iterations: [],
  };
}

/** Records that the comment was filed in a tracker; a later call replaces an earlier value. */
export function markSentToTracker(file: InboxFile, sent: SentToTracker): InboxFile {
  const { tracker, ref, url } = sent;
  return { ...file, sentToTracker: { tracker, ref, ...(url !== undefined ? { url } : {}) } };
}

function withIteration(
  iterations: Iteration[],
  n: number,
  update: (it: Iteration) => Iteration,
): Iteration[] {
  const existing = iterations.find((it) => it.n === n);
  const updated = update(existing ?? { n });
  return existing ? iterations.map((it) => (it.n === n ? updated : it)) : [...iterations, updated];
}

/** Records the agent's reply on the current iteration and moves `ack` to `proposed`. */
export function appendReply(file: InboxFile, reply: { at: string; text: string }): InboxFile {
  const status = transition(file.status, 'proposed', 'agent');
  const iterations = withIteration(file.iterations, file.iteration, (it) => ({
    ...it,
    agent: reply,
  }));
  return { ...file, status, iterations };
}

/**
 * Records the human verdict on the current iteration. `accept` moves the status to
 * `accepted`; `decline` and `comment` open iteration n + 1 and move the status to `ack`.
 * Throws unless the current iteration has an agent reply, has no verdict yet, and the
 * status is `proposed` or `verified`.
 */
export function applyVerdict(
  file: InboxFile,
  verdict: { at: string; verdict: Verdict },
): InboxFile {
  const current = file.iterations.find((it) => it.n === file.iteration);
  if (!current?.agent) {
    throw new Error('cannot record a verdict before the agent has replied');
  }
  if (current.human) {
    throw new Error('cannot record a verdict on an iteration that already has one');
  }
  if (file.status !== 'proposed' && file.status !== 'verified') {
    throw new Error(`cannot record a verdict while status is '${file.status}'`);
  }
  const iterations = withIteration(file.iterations, file.iteration, (it) => ({
    ...it,
    human: { at: verdict.at, verdict: verdict.verdict },
  }));
  if (verdict.verdict.kind === 'accept') {
    const status = transition(file.status, 'accepted', 'human');
    return { ...file, status, iterations };
  }
  return { ...file, status: 'ack', iteration: file.iteration + 1, iterations };
}
