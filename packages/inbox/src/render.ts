// renders an InboxFile to the frozen inbox markdown layout.

import type { InboxFile, Iteration, Verdict } from './inbox-file';

function frontmatterLines(file: InboxFile): string[] {
  const lines = [
    `id: ${JSON.stringify(file.id)}`,
    `schemaVersion: ${file.schemaVersion}`,
    `batchId: ${JSON.stringify(file.batchId)}`,
  ];
  if (file.category !== undefined) lines.push(`category: ${JSON.stringify(file.category)}`);
  lines.push(
    `status: ${JSON.stringify(file.status)}`,
    `iteration: ${file.iteration}`,
    `route: ${JSON.stringify(file.route)}`,
    `selector: ${JSON.stringify(file.selector)}`,
  );
  if (file.file !== undefined) lines.push(`file: ${JSON.stringify(file.file)}`);
  if (file.buildId !== undefined) lines.push(`buildId: ${JSON.stringify(file.buildId)}`);
  lines.push(`createdAt: ${JSON.stringify(file.createdAt)}`);
  if (file.orphaned) lines.push('orphaned: true');
  if (file.parked) lines.push('parked: true');
  if (file.sentToTracker !== undefined) {
    const { tracker, ref, url } = file.sentToTracker;
    const sent = url !== undefined ? { tracker, ref, url } : { tracker, ref };
    lines.push(`sentToTracker: ${JSON.stringify(sent)}`);
  }
  return lines;
}

const ESCAPED_PREFIXES = ['**human** ', '**agent** ', '## Iteration ', 'Wireframe: '] as const;

/** True for a free-text line that would otherwise read as a delimiter, a fence, or an escape. */
function needsEscape(line: string): boolean {
  return (
    line.startsWith('\\') ||
    line.startsWith('```') ||
    ESCAPED_PREFIXES.some((p) => line.startsWith(p))
  );
}

function escapeLine(line: string): string {
  return needsEscape(line) ? `\\${line}` : line;
}

/** Escapes every line of a free-text block that stands alone (the comment). */
function escapeFreeText(text: string): string {
  return text.split('\n').map(escapeLine).join('\n');
}

/** Escapes the continuation lines of free text whose first line is embedded on a marker line. */
function escapeContinuation(text: string): string {
  const [first, ...rest] = text.split('\n');
  return [first, ...rest.map(escapeLine)].join('\n');
}

function renderVerdict(verdict: Verdict): string {
  switch (verdict.kind) {
    case 'accept':
      return 'accept';
    case 'decline':
      return `decline: ${escapeContinuation(verdict.reason)}`;
    case 'comment':
      return `comment: ${escapeContinuation(verdict.text)}`;
  }
}

function renderIteration(it: Iteration): string[] {
  const lines = [`## Iteration ${it.n}`];
  if (it.statuses !== undefined) lines.push('', `**statuses** ${JSON.stringify(it.statuses)}`);
  if (it.agent) lines.push('', `**agent** ${it.agent.at} ${escapeContinuation(it.agent.text)}`);
  if (it.human) lines.push('', `**human** ${it.human.at} ${renderVerdict(it.human.verdict)}`);
  return lines;
}

/** Renders an inbox file exactly per CONTRACTS.md §2. */
export function render(file: InboxFile): string {
  const parts = [
    '---',
    ...frontmatterLines(file),
    '---',
    ...(file.comment === '' ? [] : [escapeFreeText(file.comment)]),
    '',
    '```json annotations',
    JSON.stringify(file.annotations, null, 2),
    '```',
    ...(file.wireframe === true ? [`Wireframe: ./${file.id}/wireframe.svg`] : []),
  ];
  for (const it of file.iterations) {
    parts.push('', ...renderIteration(it));
  }
  return `${parts.join('\n')}\n`;
}
