// parses the frozen inbox markdown layout back into an InboxFile.

import { Annotation, ChannelStatus } from '@passback/schema';
import { MARK_STATUSES, type MarkStatus } from './status';
import type { InboxFile, Iteration, IterationStatus, SentToTracker, Verdict } from './inbox-file';

const POSITIVE_INT_RE = /^[1-9][0-9]*$/;

/** Validates a positive-integer string per CONTRACTS.md §2; throws `Error` naming `raw`. */
function parsePositiveInt(raw: string, what: string): number {
  if (!POSITIVE_INT_RE.test(raw))
    throw new Error(`${what} must be a positive integer, got: ${raw}`);
  return Number(raw);
}

const SENT_KEYS = ['tracker', 'ref', 'url'];

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value !== '';
}

/** Validates a `sentToTracker` line per CONTRACTS.md §2; throws `Error` naming the field. */
function parseSentToTracker(raw: string): SentToTracker {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`sentToTracker is not valid JSON: ${raw}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`sentToTracker must be an object, got: ${raw}`);
  }
  const obj = value as Record<string, unknown>;
  const unknown = Object.keys(obj).find((k) => !SENT_KEYS.includes(k));
  if (unknown !== undefined) throw new Error(`sentToTracker has an unknown key: ${unknown}`);
  if (!nonEmptyString(obj.tracker) || !nonEmptyString(obj.ref)) {
    throw new Error('sentToTracker needs a non-empty string tracker and ref');
  }
  if (obj.url !== undefined && typeof obj.url !== 'string') {
    throw new Error('sentToTracker url must be a string');
  }
  return obj as SentToTracker;
}

function parseFrontmatterValue(key: string, raw: string): unknown {
  const trimmed = raw.trim();
  if (key === 'sentToTracker') return parseSentToTracker(trimmed);
  if (key === 'schemaVersion') return Number(trimmed);
  if (key === 'iteration') return parsePositiveInt(trimmed, 'iteration');
  if (key === 'orphaned' || key === 'parked') return trimmed === 'true';
  if (trimmed.startsWith('"')) return JSON.parse(trimmed) as unknown;
  return trimmed;
}

function requireField(fields: Record<string, unknown>, key: string): unknown {
  const value = fields[key];
  if (value === undefined) throw new Error(`inbox file missing field: ${key}`);
  return value;
}

function parseFrontmatter(
  lines: string[],
): Omit<InboxFile, 'comment' | 'annotations' | 'iterations'> {
  const fields: Record<string, unknown> = {};
  for (const line of lines) {
    const match = /^([a-zA-Z]+): (.*)$/s.exec(line);
    if (!match) throw new Error(`malformed frontmatter line: ${line}`);
    const [, key, raw] = match;
    fields[key!] = parseFrontmatterValue(key!, raw!);
  }
  const status = requireField(fields, 'status') as string;
  if (!(MARK_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`unknown status: ${status}`);
  }
  const schemaVersion = requireField(fields, 'schemaVersion') as number;
  if (schemaVersion !== 1) {
    throw new Error(`unsupported schemaVersion: ${schemaVersion}`);
  }
  return {
    id: requireField(fields, 'id') as string,
    schemaVersion: 1,
    batchId: requireField(fields, 'batchId') as string,
    category: fields.category as InboxFile['category'],
    status: status as MarkStatus,
    iteration: requireField(fields, 'iteration') as number,
    route: requireField(fields, 'route') as string,
    selector: requireField(fields, 'selector') as string,
    file: fields.file as string | undefined,
    buildId: fields.buildId as string | undefined,
    createdAt: requireField(fields, 'createdAt') as string,
    orphaned: fields.orphaned as boolean | undefined,
    parked: fields.parked as boolean | undefined,
    ...(fields.sentToTracker !== undefined
      ? { sentToTracker: fields.sentToTracker as SentToTracker }
      : {}),
  };
}

/** Removes the single leading `\` that `render` adds to an escaped free-text line. */
function unescapeLine(line: string): string {
  return line.startsWith('\\') ? line.slice(1) : line;
}

/** The inverse of `escapeFreeText`: every line, including the first, may be escaped. */
function unescapeFreeText(text: string): string {
  return text.split('\n').map(unescapeLine).join('\n');
}

function parseVerdict(raw: string): Verdict {
  if (raw === 'accept') return { kind: 'accept' };
  if (raw.startsWith('decline: '))
    return { kind: 'decline', reason: raw.slice('decline: '.length) };
  if (raw.startsWith('comment: ')) return { kind: 'comment', text: raw.slice('comment: '.length) };
  throw new Error(`malformed verdict: ${raw}`);
}

function splitMarker(line: string, prefix: string): { at: string; rest: string } {
  const withoutPrefix = line.slice(prefix.length);
  const spaceIndex = withoutPrefix.indexOf(' ');
  if (spaceIndex === -1) throw new Error(`malformed line: ${line}`);
  return { at: withoutPrefix.slice(0, spaceIndex), rest: withoutPrefix.slice(spaceIndex + 1) };
}

type OpenField = { kind: 'agent' | 'human'; at: string; lines: string[] };
type ParseState = { iterations: Iteration[]; current?: Iteration; open?: OpenField };

/**
 * Joins an open field's raw lines back into text: the first line is the inline segment on the
 * marker line (never escaped), the rest are escaped continuation lines, and the single trailing
 * blank line is the separator `render` inserts before the next block, not content.
 */
function finalizeOpenLines(lines: string[]): string {
  const body = lines.length > 0 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  const [first, ...rest] = body;
  return [first ?? '', ...rest.map(unescapeLine)].join('\n');
}

function closeField(current: Iteration, open: OpenField | undefined): void {
  if (!open) return;
  const value = finalizeOpenLines(open.lines);
  if (open.kind === 'agent') current.agent = { at: open.at, text: value };
  else current.human = { at: open.at, verdict: parseVerdict(value) };
}

/** Enforces CONTRACTS.md §2: iterations are numbered strictly 1..N, in order, no repeats. */
function checkIterationNumber(iterations: Iteration[], n: number): void {
  if (iterations.some((it) => it.n === n)) {
    throw new Error(`duplicate iteration heading: ${n}`);
  }
  const expected = iterations.length + 1;
  if (n !== expected) {
    throw new Error(`iteration heading ${n} out of order: expected ${expected}`);
  }
}

function startIteration(state: ParseState, line: string): ParseState {
  if (state.current) closeField(state.current, state.open);
  const iterations = state.current ? [...state.iterations, state.current] : state.iterations;
  const n = parsePositiveInt(line.slice('## Iteration '.length).trim(), 'iteration heading');
  checkIterationNumber(iterations, n);
  return { iterations, current: { n } };
}

/** Enforces CONTRACTS.md §2: a human verdict never precedes the agent reply it responds to. */
function checkHumanAfterAgent(state: ParseState, current: Iteration): void {
  const hasAgent = current.agent !== undefined || state.open?.kind === 'agent';
  if (!hasAgent) {
    throw new Error(`iteration ${current.n} has a **human** verdict before the **agent** reply`);
  }
}

function startField(state: ParseState, line: string, kind: OpenField['kind']): ParseState {
  if (!state.current) throw new Error(`iteration content before a header: ${line}`);
  const alreadyClosed = kind === 'agent' ? state.current.agent : state.current.human;
  if (alreadyClosed || state.open?.kind === kind) {
    throw new Error(`iteration ${state.current.n} has more than one **${kind}** line`);
  }
  if (kind === 'human') checkHumanAfterAgent(state, state.current);
  closeField(state.current, state.open);
  const { at, rest } = splitMarker(line, kind === 'agent' ? '**agent** ' : '**human** ');
  return { ...state, open: { kind, at, lines: [rest] } };
}

const StatusEntries = ChannelStatus.pick({
  state: true,
  message: true,
  prUrl: true,
  at: true,
})
  .strict()
  .array();

/** Parses a `**statuses** <json>` line; only valid before an agent or human field has opened. */
function startStatuses(state: ParseState, line: string): ParseState {
  if (!state.current) throw new Error(`iteration content before a header: ${line}`);
  if (state.current.statuses !== undefined) {
    throw new Error(`duplicate **statuses** in iteration ${state.current.n}`);
  }
  const value: unknown = JSON.parse(line.slice('**statuses** '.length));
  StatusEntries.parse(value);
  state.current.statuses = value as IterationStatus[];
  return state;
}

/** Splits the iterations section into `Iteration`s, honouring escaped delimiters and blank lines. */
function parseIterations(text: string): Iteration[] {
  if (text === '') return [];
  let state: ParseState = { iterations: [] };
  for (const line of text.split('\n')) {
    if (line.startsWith('## Iteration ')) state = startIteration(state, line);
    else if (!state.open && line.startsWith('**statuses** ')) state = startStatuses(state, line);
    else if (line.startsWith('**agent** ')) state = startField(state, line, 'agent');
    else if (line.startsWith('**human** ')) state = startField(state, line, 'human');
    else if (!state.open) {
      if (line !== '') throw new Error(`iteration content before a header: ${line}`);
    } else {
      state.open.lines.push(line);
    }
  }
  if (!state.current) return state.iterations;
  closeField(state.current, state.open);
  return [...state.iterations, state.current];
}

const HEADER_RE = /^---\n([\s\S]*?)\n---\n/;
const FENCE_LINE = '```json annotations';
const CLOSE_RE = /^([\s\S]*?)\n```\n(Wireframe: [^\n]*\n?)?([\s\S]*)$/;

/**
 * Splits the text after the frontmatter into the comment and the rest (starting at the
 * annotations fence line). The comment sits directly under the closing `---`, with no forced
 * blank line before it; the single blank line right before the fence is the separator, not
 * comment content, so leading blank lines inside the comment are preserved.
 */
function splitComment(afterHeader: string): { comment: string; rest: string } {
  const lines = afterHeader.split('\n');
  const fenceIndex = lines.indexOf(FENCE_LINE);
  if (fenceIndex <= 0 || lines[fenceIndex - 1] !== '') {
    throw new Error('inbox file missing annotations block');
  }
  const comment = unescapeFreeText(lines.slice(0, fenceIndex - 1).join('\n'));
  const rest = lines.slice(fenceIndex + 1).join('\n');
  return { comment, rest };
}

/** The inverse of `render`; throws `Error` naming the problem on malformed input. */
export function parse(text: string): InboxFile {
  const headerMatch = HEADER_RE.exec(text);
  if (!headerMatch) throw new Error('inbox file missing frontmatter');
  const frontmatter = parseFrontmatter(headerMatch[1]!.split('\n'));
  const afterHeader = text.slice(headerMatch[0].length);

  const { comment, rest: afterFence } = splitComment(afterHeader);

  const closeMatch = CLOSE_RE.exec(afterFence);
  if (!closeMatch) throw new Error('inbox file missing closing annotations fence');
  const annotations = Annotation.array().parse(JSON.parse(closeMatch[1]!));
  const iterations = parseIterations(closeMatch[3] ?? '');

  return {
    ...frontmatter,
    comment,
    annotations,
    iterations,
    ...(closeMatch[2] !== undefined ? { wireframe: true as const } : {}),
  };
}
