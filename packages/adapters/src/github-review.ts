// Renders the open local inbox marks as one GitHub PR review. Pure: no clock, no randomness.
// The inbox files were redacted when they were written (FileInboxAdapter runs redact() before
// fromPayload), so this renderer runs no redact() of its own.

import type { InboxFile } from '@passback/inbox';

export const OPEN_MARK_STATUSES = ['new', 'ack', 'proposed'] as const;

export type PrReview = {
  commit_id: string;
  event: 'COMMENT';
  body: string;
  comments: { path: string; line: number; side: 'RIGHT'; body: string }[];
};

export type RenderedPrReview = { review: PrReview; inline: string[]; unplaced: string[] };

/** An open mark is one the human has not closed: orphaned marks stay open. */
export function isOpenMark(file: InboxFile): boolean {
  return (OPEN_MARK_STATUSES as readonly string[]).includes(file.status);
}

/** The hidden marker every posted line for a mark carries, so a later run can find it. */
export function markMarker(id: string): string {
  return `<!-- passback:mark:${id} -->`;
}

function parseLocation(file: string | undefined): { path: string; line: number } | undefined {
  if (file === undefined) return undefined;
  const m = /^(.+?):(\d+)(?::\d+)?$/.exec(file);
  if (!m?.[1] || !m[2]) return undefined;
  const line = Number(m[2]);
  return Number.isSafeInteger(line) && line > 0 ? { path: m[1], line } : undefined;
}

function inlineBody(mark: InboxFile): string {
  const selector = mark.selector === '' ? '' : ` · selector ${mark.selector}`;
  const meta = `passback mark ${mark.id} · route ${mark.route}${selector}`;
  return `${mark.comment.trim()}\n\n${meta}\n${markMarker(mark.id)}`;
}

function unplacedLine(mark: InboxFile): string {
  const first = mark.comment.trim().split('\n')[0] ?? '';
  const where = mark.file ?? 'no source location';
  return `- \`${mark.id}\` \`${mark.route}\`: ${first} (${where}) ${markMarker(mark.id)}`;
}

export function renderPrReview(
  marks: readonly InboxFile[],
  opts: {
    commitId: string;
    isCommentable(path: string, line: number): boolean;
    alreadyPosted?: ReadonlySet<string>;
  },
): RenderedPrReview | undefined {
  const todo = marks
    .filter((m) => isOpenMark(m) && !opts.alreadyPosted?.has(m.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (todo.length === 0) return undefined;

  const comments: PrReview['comments'] = [];
  const inline: string[] = [];
  const unplaced: string[] = [];
  const lines: string[] = [];
  for (const mark of todo) {
    const loc = parseLocation(mark.file);
    if (loc && opts.isCommentable(loc.path, loc.line)) {
      comments.push({ path: loc.path, line: loc.line, side: 'RIGHT', body: inlineBody(mark) });
      inline.push(mark.id);
    } else {
      lines.push(unplacedLine(mark));
      unplaced.push(mark.id);
    }
  }

  const head = `passback: open marks ${todo.length} (${inline.length} inline, ${unplaced.length} in this list)`;
  const body =
    unplaced.length > 0 ? [head, '', '### Not placed on the diff', ...lines].join('\n') : head;
  return {
    review: { commit_id: opts.commitId, event: 'COMMENT', body, comments },
    inline,
    unplaced,
  };
}
