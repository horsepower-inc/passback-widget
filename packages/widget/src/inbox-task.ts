import { awaitsAnswer, sectionOf, type InboxRowView } from './inbox-sections';
import { renderWithdraw, type HeldState } from './inbox-held';
import { verdictOf, type VerdictPort } from './inbox-verdict';
import { reopenOf, type ReopenPort } from './reopen';
import { answerOf, type AnswerPort } from './answer';

export type TaskLine = {
  who: string;
  at: string;
  text: string;
  kind: 'comment' | 'status' | 'agent' | 'verdict' | 'question';
};
export type Task = {
  number?: number;
  title: string;
  fileLine?: string;
  page: string;
  round: string;
  lines: TaskLine[];
};

const TITLE_MAX = 80;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const time = (at: string): number => {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? 0 : ms;
};

function verdictLine(human: unknown): Omit<TaskLine, 'kind'> | undefined {
  const verdict = isObject(human) && isObject(human.verdict) ? human.verdict : undefined;
  const at = isObject(human) ? str(human.at) : '';
  if (verdict?.kind === 'accept') return { who: 'You accepted', at, text: '' };
  if (verdict?.kind === 'decline')
    return { who: 'You: still wrong', at, text: str(verdict.reason) };
  if (verdict?.kind === 'comment') return { who: 'You', at, text: str(verdict.text) };
  return undefined;
}

function iterationLines(iterations: unknown): TaskLine[] {
  const lines: TaskLine[] = [];
  for (const it of Array.isArray(iterations) ? iterations : []) {
    if (!isObject(it)) continue;
    for (const s of Array.isArray(it.statuses) ? it.statuses : []) {
      if (!isObject(s)) continue;
      const text = str(s.message) || str(s.state);
      if (s.state === 'question')
        lines.push({ who: 'Agent asks', at: str(s.at), text: str(s.message), kind: 'question' });
      else lines.push({ who: 'Agent', at: str(s.at), text, kind: 'status' });
    }
    if (isObject(it.agent))
      lines.push({ who: 'Agent', at: str(it.agent.at), text: str(it.agent.text), kind: 'agent' });
    const verdict = verdictLine(it.human);
    if (verdict) lines.push({ ...verdict, kind: 'verdict' });
  }
  return lines;
}

/** The task the panel shows for an inbox row: header facts and the conversation, oldest first. */
export function taskOf(row: InboxRowView, n?: number): Task {
  const comment = str(row.comment);
  const lines: TaskLine[] = [
    { who: 'You', at: row.createdAt, text: comment, kind: 'comment' },
    ...iterationLines(row.iterations),
  ];
  lines.sort((a, b) => time(a.at) - time(b.at));
  return {
    ...(n === undefined ? {} : { number: n }),
    title: (comment.split('\n')[0] ?? '').slice(0, TITLE_MAX),
    ...(row.file ? { fileLine: row.file.replace(/(:\d+):\d+$/, '$1') } : {}),
    page: row.route,
    round: `Round ${row.iteration}`,
    lines,
  };
}

/** What the view keeps across renders so a feed change does not lose the typed answer. */
export type TaskState = { draft: string; failed: boolean; sending?: boolean };
export type TaskContext = {
  port: ReopenPort | undefined;
  answer?: AnswerPort;
  verdict?: VerdictPort;
  held?: HeldState;
  mac: boolean;
  state: TaskState;
  now?: Date;
  close(): void;
  /** Draws the task again; a send that ends after a feed redraw shows its outcome this way. */
  redraw?(): void;
};

const pad = (n: number): string => String(n).padStart(2, '0');
function whenOf(at: string, now: Date): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = d.toDateString() === now.toDateString();
  return today ? clock : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`;
}

const FIXED = ['proposed', 'verified'];

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function headerNode(doc: Document, task: Task, close: () => void): HTMLElement {
  const head = el(doc, 'div', 'pb-it-head');
  const back = el(doc, 'button', 'pb-it-back', '← List');
  back.type = 'button';
  back.addEventListener('click', close);
  const title = el(doc, 'div', 'pb-it-title');
  if (task.number !== undefined) title.append(el(doc, 'span', 'pb-it-n', String(task.number)));
  title.append(el(doc, 'span', 'pb-it-name', task.title));
  const facts = [task.fileLine, task.page, task.round].filter(Boolean).join(' · ');
  head.append(back, title, el(doc, 'div', 'pb-it-facts', facts));
  return head;
}

function conversationNode(doc: Document, task: Task, now: Date): HTMLElement {
  const box = el(doc, 'div', 'pb-it-lines');
  for (const line of task.lines) {
    const node = el(doc, 'div', 'pb-it-line');
    node.dataset.kind = line.kind;
    const meta = el(doc, 'div', 'pb-it-meta');
    meta.append(el(doc, 'span', 'pb-it-who', line.who));
    meta.append(el(doc, 'span', 'pb-it-at', whenOf(line.at, now)));
    node.append(meta);
    if (line.text) node.append(el(doc, 'div', 'pb-it-text', line.text));
    box.append(node);
  }
  return box;
}

function answerNode(doc: Document, row: InboxRowView, ctx: TaskContext): HTMLElement {
  const { state } = ctx;
  const asked = awaitsAnswer(row);
  const fixed = FIXED.includes(row.status);
  const port: { send(id: string, text: string): Promise<boolean> } | undefined = asked
    ? ctx.answer
    : ctx.port;
  const answerable = asked || fixed;
  const enabled = answerable && port !== undefined;
  const box = el(doc, 'div', 'pb-it-answer');
  const area = el(doc, 'textarea', 'pb-it-box');
  area.value = state.draft;
  area.disabled = !enabled;
  area.setAttribute('aria-label', 'Your answer');
  const label = asked ? 'Answer' : 'Send';
  const send = el(doc, 'button', 'pb-it-send', `${label} ${ctx.mac ? '⌘↵' : 'Ctrl+Enter'}`);
  send.type = 'button';
  const note = el(doc, 'div', 'pb-it-note');
  if (!answerable) note.textContent = 'You can answer once the agent has proposed a fix.';
  else if (!port) note.textContent = 'Answering is not available in this setup.';
  else if (state.failed) note.textContent = 'Could not send. Try again.';
  const refresh = (): void => {
    send.disabled = !enabled || state.sending === true;
  };
  const submit = async (): Promise<void> => {
    const text = area.value.trim();
    if (!port || !enabled || state.sending || text === '') return;
    state.sending = true;
    refresh();
    const ok = await port.send(row.id, text).catch(() => false);
    state.sending = false;
    state.failed = !ok;
    if (ok) state.draft = '';
    if (!box.isConnected) return ctx.redraw?.();
    if (ok) area.value = '';
    note.textContent = ok ? '' : 'Could not send. Try again.';
    refresh();
  };
  area.addEventListener('input', () => {
    state.draft = area.value;
  });
  area.addEventListener('keydown', (event) => {
    const chord = ctx.mac ? event.metaKey : event.ctrlKey;
    if (event.key === 'Enter' && chord) {
      event.preventDefault();
      void submit();
    }
  });
  send.addEventListener('click', () => void submit());
  refresh();
  const actions = el(doc, 'div', 'pb-it-actions');
  const withdraw = renderWithdraw({ doc, row, verdict: ctx.verdict, state: ctx.held });
  actions.append(note, ...(withdraw ? [withdraw] : []), send);
  box.append(area, actions);
  return box;
}

/** The open task: header, conversation and answer box for one row. */
export function taskNode(
  doc: Document,
  row: InboxRowView,
  n: number | undefined,
  ctx: TaskContext,
) {
  const task = taskOf(row, n);
  const root = el(doc, 'div', 'pb-it');
  root.append(
    headerNode(doc, task, ctx.close),
    conversationNode(doc, task, ctx.now ?? new Date()),
    answerNode(doc, row, ctx),
  );
  return root;
}

/** The open row, if it is still listed; a withdrawn row stays in the snapshot but has no section. */
export const openRow = (rows: readonly InboxRowView[], id: string | undefined) =>
  id === undefined ? undefined : rows.find((r) => r.id === id && sectionOf(r));

type Listed = { key: string; row?: InboxRowView };
// Enter on a focused row opens that row; elsewhere it opens the selected one.
export function rowOf(event: KeyboardEvent, items: readonly Listed[], selected: number) {
  const { target } = event;
  const key = target instanceof HTMLElement && target.matches('.pb-iv-row') && target.dataset.key;
  return (key ? items.find((i) => i.key === key) : items[selected])?.row;
}

/** Draws the task in place of the menu and list; a focused answer box keeps its focus. */
export function showTask(
  root: HTMLElement,
  row: InboxRowView,
  ctx: {
    win: Window;
    mac: boolean;
    state: TaskState;
    held?: { state: HeldState };
    close(): void;
    redraw(): void;
  },
): void {
  const box = (): HTMLElement | null => root.querySelector('.pb-it-box');
  const refocus = box() !== null && box() === (root.getRootNode() as Document).activeElement;
  const { mac, state, held, close, redraw } = ctx;
  const port = reopenOf(ctx.win as Window & typeof globalThis);
  const node = taskNode(root.ownerDocument, row, undefined, {
    port,
    answer: answerOf(ctx.win as Window & typeof globalThis),
    verdict: verdictOf(ctx.win),
    held: held?.state,
    mac,
    state,
    close,
    redraw,
  });
  root.replaceChildren(node);
  if (refocus) box()?.focus();
}
