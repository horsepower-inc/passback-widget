import { createBubble, type Bubble } from './bubble-view';
import { createDot } from './dot-view';
import type { RestoreEntry } from './inbox-restore';
import type { Launcher } from './launcher';
import { applyStatus } from './overlay-marks';
import type { TrackedMark } from './overlay-reattach';

type Ctx = {
  doc: Document;
  root: ShadowRoot;
  launcher: Launcher;
  rows: { changed(): void };
  state: { marks: TrackedMark[]; dismissed?: Map<string, string> };
};

// The marks this module made; a mark of this session is never in it.
const restored = new WeakSet<TrackedMark>();

const cornerOf = (element: Element): { x: number; y: number } => {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top };
};

/** A bubble focuses its textarea when made; made off the page, the focus never moves. */
function closedBubble(ctx: Ctx, point: { x: number; y: number }): Bubble {
  const scratch = ctx.doc.createElement('div').attachShadow({ mode: 'open' });
  const bubble = createBubble(scratch, {
    anchor: point,
    onSend: () => undefined,
    onCancel: () => undefined,
  });
  ctx.root.appendChild(bubble.element);
  return bubble;
}

function add(ctx: Ctx, entry: RestoreEntry): void {
  const point = cornerOf(entry.element);
  const status = { markId: entry.id, state: entry.state, message: entry.message };
  const dot = createDot(ctx.root, point, entry.n, entry.state);
  const bubble = closedBubble(ctx, point);
  bubble.showStatus(status);
  bubble.element.hidden = true;
  const mark: TrackedMark = {
    id: entry.id,
    dot,
    bubble,
    target: entry.target,
    element: entry.element,
    offset: { x: 0, y: 0 },
    lastState: entry.state,
    comment: entry.message,
  };
  restored.add(mark);
  ctx.state.marks.push(mark);
}

function drop(ctx: Ctx, mark: TrackedMark): void {
  mark.dot.remove();
  mark.bubble.destroy();
  ctx.state.marks = ctx.state.marks.filter((candidate) => candidate !== mark);
}

function update(ctx: Ctx, mark: TrackedMark, entry: RestoreEntry): void {
  if (mark.dot.element.textContent !== String(entry.n)) {
    drop(ctx, mark);
    add(ctx, entry);
    return;
  }
  if (mark.lastState !== entry.state || mark.comment !== entry.message) {
    const closed = mark.bubble.element.hidden;
    applyStatus(ctx.state.marks, { markId: entry.id, state: entry.state, message: entry.message });
    mark.bubble.element.hidden = closed;
    mark.comment = entry.message;
  }
  if (mark.element !== entry.element) {
    const point = cornerOf(entry.element);
    mark.element = entry.element;
    mark.dot.moveTo(point);
    mark.bubble.moveTo(point);
  }
}

/** Brings the marks of the inbox rows in line with the entries; marks of this session stay as they are. */
export function reconcileRestored(ctx: Ctx, entries: readonly RestoreEntry[]): void {
  const ids = new Set(entries.map((entry) => entry.id));
  for (const mark of [...ctx.state.marks]) {
    if (restored.has(mark) && !(mark.id !== undefined && ids.has(mark.id))) drop(ctx, mark);
  }
  for (const entry of entries) {
    const mark = ctx.state.marks.find((candidate) => candidate.id === entry.id);
    if (mark === undefined) {
      if (ctx.state.dismissed?.get(entry.id) === entry.state) continue;
      ctx.state.dismissed?.delete(entry.id);
      add(ctx, entry);
    } else if (restored.has(mark)) update(ctx, mark, entry);
  }
  ctx.launcher.update(ctx.state.marks);
  ctx.rows.changed();
}
