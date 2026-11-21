import type { Payload } from '@passback/schema';
import { REVIEW_STORAGE_KEY, reviewOf } from './review-link';
import {
  NO_ANSWER,
  REFUSED,
  postReview,
  reviewFailure,
  sendReviewMarks,
  type ReviewFailure,
  type ReviewSendResult,
} from './send';
import { newUlid } from './ulid';

// The widget's own copy of what the relay answers; every word on screen comes from the server.
export type ReviewSession = {
  v: 1;
  state: 'open';
  title: string;
  version: string;
  round: number;
  check: string;
  labels: { key: string; label: string }[];
  comments: ReviewComment[];
  finish: { key: 'send_back'; label: string; enabled: boolean; note?: string }[];
  // Input data that nothing reads yet.
  fixes?: { comment: string; text: string; line: string }[];
  featureUrl: string;
  expiresAt: string;
  cursor: string;
};

export type ReviewComment = {
  id: string;
  mark: string;
  text: string;
  label: string | null;
  status: string;
  tone: 'plain' | 'ask';
  overruled: boolean;
  question?: string;
};

export type ReviewUpdate =
  | { kind: 'session'; session: ReviewSession }
  | { kind: 'failure'; failure: ReviewFailure }
  | { kind: 'ended'; code: string };

export type ReviewSent = ReviewSendResult & { batchId: string };
export type ReviewCheck = { comment: string; verdict: 'fixed' | 'still_wrong' };
export type OverruleResult = { ok: true; comment: string; status: string } | ReviewFailure;
export type FinishResult =
  { ok: true; summary: { label: string; value: string }[] } | ReviewFailure;

export type ReviewSessionOptions = {
  win: Pick<Window, 'location' | 'sessionStorage'>;
  endpoint: string;
  state(): { visible: boolean; open: boolean };
  /** Sends the caller's unsent comments; anything but true keeps the finish from being posted. */
  flush(): Promise<boolean>;
  onUpdate?(update: ReviewUpdate): void;
  fetchFn?: typeof fetch;
  setTimer?(run: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  newId?: () => string;
};

export type ReviewClient = {
  session(): ReviewSession | undefined;
  stateChanged(): void;
  send(payloads: readonly Payload[], batchId?: string): Promise<ReviewSent>;
  overrule(comment: string, label: string): Promise<OverruleResult>;
  finish(checks?: ReviewCheck[]): Promise<FinishResult>;
  dispose(): void;
};

type Answer = { ok: true; body: unknown } | ReviewFailure;

const OPEN_MS = 15_000;
const HIDDEN_MS = 60_000;
const TERMINAL = ['review_not_found', 'review_finished', 'review_expired'];
const MALFORMED: ReviewFailure = { ok: false, reason: 'rejected', message: REFUSED };

const isText = (value: unknown): value is string => typeof value === 'string';
const isList = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'object' && entry !== null);

function isComment(c: Record<string, unknown>): boolean {
  return (
    [c.id, c.mark, c.text, c.status].every(isText) &&
    (c.label === null || isText(c.label)) &&
    (c.tone === 'plain' || c.tone === 'ask') &&
    typeof c.overruled === 'boolean' &&
    (c.question === undefined || isText(c.question))
  );
}

function isSession(value: unknown): value is ReviewSession {
  const b = (value ?? {}) as Record<string, unknown>;
  return (
    b.v === 1 &&
    b.state === 'open' &&
    [b.title, b.version, b.check, b.featureUrl, b.expiresAt, b.cursor].every(isText) &&
    typeof b.round === 'number' &&
    isList(b.finish) &&
    isList(b.labels) &&
    b.labels.every((entry) => isText(entry.key) && isText(entry.label)) &&
    isList(b.comments) &&
    b.comments.every(isComment) &&
    (b.fixes === undefined || isList(b.fixes))
  );
}

function isSummary(value: unknown): value is { label: string; value: string }[] {
  return isList(value) && value.every((entry) => isText(entry.label) && isText(entry.value));
}

// A read carries only the comments that changed since the cursor.
function merged(kept: ReviewSession | undefined, next: ReviewSession): ReviewSession {
  if (!kept) return next;
  const changed = new Map(next.comments.map((comment) => [comment.id, comment]));
  const comments = kept.comments.map((comment) => {
    const fresh = changed.get(comment.id);
    changed.delete(comment.id);
    return fresh ?? comment;
  });
  return { ...next, comments: [...comments, ...changed.values()] };
}

class Client implements ReviewClient {
  private id: string | undefined;
  private kept: ReviewSession | undefined;
  private ended: string | undefined;
  private disposed = false;
  private reading = false;
  private overrules = 0;
  private timer: unknown;
  private finishId: string | undefined;
  private finishing: Promise<FinishResult> | undefined;

  constructor(private readonly opts: ReviewSessionOptions) {
    this.id = reviewOf(opts.win);
    if (this.id !== undefined) void this.read();
  }

  session(): ReviewSession | undefined {
    return this.kept;
  }

  stateChanged(): void {
    this.cancel();
    if (!this.usable() || this.reading) return;
    const { setTimer = (run, ms) => setTimeout(run, ms) } = this.opts;
    try {
      const { visible, open } = this.opts.state();
      if (visible && !open && this.kept) return;
      this.timer = setTimer(() => void this.read(), visible ? OPEN_MS : HIDDEN_MS);
    } catch {
      // an input that throws suspends polling until the next state change
    }
  }

  async send(payloads: readonly Payload[], given?: string): Promise<ReviewSent> {
    const batchId = given ?? (this.opts.newId ?? newUlid)();
    if (!this.usable() || !this.kept) return { ...this.inactive(), batchId };
    const { endpoint, fetchFn } = this.opts;
    const review = this.id as string;
    const via = fetchFn ? { fetchFn } : {};
    const newId = () => batchId;
    const result = await sendReviewMarks({ payloads, endpoint, review, newId, ...via });
    return { ...(result.ok ? result : this.refused(result)), batchId };
  }

  async overrule(comment: string, label: string): Promise<OverruleResult> {
    if (!this.usable() || !this.kept) return this.inactive();
    const answer = await this.request('overrule', { comment, label });
    if (!answer.ok) return this.refused(answer);
    const { comment: named, status } = (answer.body ?? {}) as Record<string, unknown>;
    if (named !== comment || !isText(status)) return MALFORMED;
    if (this.usable() && this.kept) {
      const comments = this.kept.comments.map((kept) =>
        kept.id === comment ? { ...kept, status, overruled: true } : kept,
      );
      this.overrules++;
      this.kept = { ...this.kept, comments };
      this.publish({ kind: 'session', session: this.kept });
    }
    return { ok: true, comment, status };
  }

  finish(checks?: ReviewCheck[]): Promise<FinishResult> {
    this.finishing ??= this.postFinish(checks).finally(() => {
      this.finishing = undefined;
    });
    return this.finishing;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private usable(): boolean {
    return !this.disposed && this.id !== undefined;
  }

  private inactive(): ReviewFailure {
    return { ...MALFORMED, code: this.ended ?? 'review_inactive' };
  }

  private publish(update: ReviewUpdate): void {
    try {
      this.opts.onUpdate?.(update);
    } catch {
      // the caller's listener stays the caller's problem
    }
  }

  private cancel(): void {
    const { clearTimer = (handle) => clearTimeout(handle as number) } = this.opts;
    if (this.timer !== undefined) clearTimer(this.timer);
    this.timer = undefined;
  }

  private stop(code: string): void {
    this.id = undefined;
    this.kept = undefined;
    this.ended = code;
    this.cancel();
    try {
      this.opts.win.sessionStorage.removeItem(REVIEW_STORAGE_KEY);
    } catch {
      // storage blocked: nothing was kept
    }
  }

  private refused(failure: ReviewFailure): ReviewFailure {
    const { code } = failure;
    if (this.usable() && code !== undefined && TERMINAL.includes(code)) {
      this.stop(code);
      this.publish({ kind: 'ended', code });
    }
    return failure;
  }

  private async request(op: string, fields: object): Promise<Answer> {
    let response: Response;
    try {
      const body = JSON.stringify({ v: 1, review: this.id, ...fields });
      const base = this.opts.endpoint.replace(/\/+$/, '');
      response = await postReview(this.opts.fetchFn, `${base}/review/${op}`, body);
    } catch {
      return { ok: false, reason: 'network', message: NO_ANSWER };
    }
    if (!response.ok) return reviewFailure(response);
    try {
      return { ok: true, body: await response.json() };
    } catch {
      return MALFORMED;
    }
  }

  private async read(): Promise<void> {
    this.timer = undefined;
    this.reading = true;
    const started = this.overrules;
    const answer = await this.request('read', this.kept ? { after: this.kept.cursor } : {});
    this.reading = false;
    if (!this.usable()) return;
    // It carries comments as they were before the overrule; the next read asks from the same cursor.
    if (answer.ok && started !== this.overrules) return this.stateChanged();
    if (answer.ok && isSession(answer.body)) {
      this.kept = merged(this.kept, answer.body);
      this.publish({ kind: 'session', session: this.kept });
    } else {
      const failure = answer.ok ? MALFORMED : answer;
      // An old relay has no review routes at all.
      const bare = !this.kept && failure.status === 404 && failure.code === undefined;
      this.refused(bare ? { ...failure, code: 'review_not_found' } : failure);
      if (this.usable()) this.publish({ kind: 'failure', failure });
    }
    this.stateChanged();
  }

  private async postFinish(checks: ReviewCheck[] | undefined): Promise<FinishResult> {
    if (!this.usable() || !this.kept) return this.inactive();
    const flushed = await new Promise((resolve) => resolve(this.opts.flush())).catch(() => false);
    if (flushed !== true) return { ...MALFORMED, code: 'flush_failed' };
    if (!this.usable()) return this.inactive();
    const finish_id = (this.finishId ??= (this.opts.newId ?? newUlid)());
    const extra = checks ? { checks } : {};
    const answer = await this.request('finish', { finish: 'send_back', finish_id, ...extra });
    if (!answer.ok) return this.refused(answer);
    const { summary } = (answer.body ?? {}) as Record<string, unknown>;
    if (!isSummary(summary)) return MALFORMED;
    if (!this.disposed) this.stop('review_finished');
    return { ok: true, summary };
  }
}

export const createReviewSession = (opts: ReviewSessionOptions): ReviewClient => new Client(opts);
