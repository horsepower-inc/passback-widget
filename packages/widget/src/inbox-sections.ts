// The Inbox panel's sections: pure, no DOM. The row type is structural; the widget never imports the adapters.
export type InboxRowView = {
  id: string;
  status: string;
  iteration: number;
  comment: string;
  createdAt: string;
  route: string;
  file?: string;
  parked?: boolean;
  orphaned?: boolean;
  iterations: {
    n: number;
    statuses?: { state: string; message?: string; at: string }[];
    agent?: unknown;
    human?: unknown;
  }[];
  target?: { tag: string; text: string };
};

export type Section = 'needs' | 'send' | 'working' | 'fixed' | 'tracker';
export type SectionKey = 'all' | Section;
export const ORDER: readonly Section[] = ['needs', 'send', 'working', 'fixed', 'tracker'];

type Status = NonNullable<InboxRowView['iterations'][number]['statuses']>[number];
const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

/** The last status of the last iteration; a malformed iteration or status reads as none. */
function lastStatus(row: InboxRowView): Status | undefined {
  const last: unknown = Array.isArray(row.iterations) ? row.iterations.at(-1) : undefined;
  const statuses = isObject(last) ? (last as { statuses?: unknown }).statuses : undefined;
  const status: unknown = Array.isArray(statuses) ? statuses.at(-1) : undefined;
  return isObject(status) ? (status as Status) : undefined;
}

/** True while the agent has asked a question and no later status has moved the row on. */
export const awaitsAnswer = (row: InboxRowView): boolean =>
  row.status === 'ack' && lastStatus(row)?.state === 'question';

/** The section an inbox row belongs to, or undefined when it is hidden (withdrawn). */
export function sectionOf(row: InboxRowView): Exclude<Section, 'send'> | undefined {
  if (row.status === 'withdrawn') return undefined;
  if (row.parked === true) return 'tracker';
  if (['proposed', 'verified', 'accepted'].includes(row.status)) return 'fixed';
  if (row.status === 'declined' || lastStatus(row)?.state === 'failed' || awaitsAnswer(row))
    return 'needs';
  return 'working';
}

function needsLine(row: InboxRowView): string {
  const message = lastStatus(row)?.message;
  if (awaitsAnswer(row)) return `The agent asks: ${message ?? ''}`;
  return row.status === 'declined' && !message
    ? 'The agent declined this comment'
    : (message ?? 'Failed');
}

/** One line saying where a row stands; a kept comment has no row and reads "Not sent yet". */
export function stateLine(row?: InboxRowView): string {
  if (!row) return 'Not sent yet';
  switch (sectionOf(row)) {
    case 'needs':
      return needsLine(row);
    case 'working':
      return row.status === 'ack' ? 'The agent is working' : 'Waiting for the agent';
    case 'fixed':
      return row.status === 'accepted' ? 'Accepted' : 'Fixed';
    case 'tracker':
      return 'Parked for the tracker';
    default:
      return '';
  }
}

export type Counts = Record<SectionKey, number>;

/** The count per section and for All (the sum); without a site Tracker rows count nowhere. */
export function countsOf(
  rows: readonly InboxRowView[],
  kept: number,
  withTracker: boolean,
  filed = 0,
): Counts {
  const counts: Counts = { all: 0, needs: 0, send: kept, working: 0, fixed: 0, tracker: 0 };
  for (const row of rows) {
    const section = sectionOf(row);
    if (section && (withTracker || section !== 'tracker')) counts[section] += 1;
  }
  if (withTracker) counts.tracker += filed;
  counts.all = ORDER.reduce((sum, section) => sum + counts[section], 0);
  return counts;
}

/** The state line of a comment filed in the tracker; the name is empty when no offer is known. */
export function filedLine(tracker: string | undefined, ref: string): string {
  return `Filed in ${tracker ?? 'the tracker'} · ${ref}`;
}
