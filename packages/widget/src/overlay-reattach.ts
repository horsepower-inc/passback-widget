import type { ResolveTarget } from '@passback/collectors';
import type { Offset } from '@passback/schema';
import type { Bubble } from './bubble-view';
import type { Dot, DotState } from './dot-view';
import type { Reattached } from './reattach';
import type { ViewRestore } from './view-state';

export type TrackedMark = {
  id?: string;
  dot: Dot;
  bubble: Bubble;
  offset?: Offset;
  target?: ResolveTarget;
  lastState: DotState;
  comment?: string;
  element?: Element | null;
};

export type OpenOverlayMark = { id: string; target: ResolveTarget };

export function openMarksOf(marks: readonly TrackedMark[]): OpenOverlayMark[] {
  const open: OpenOverlayMark[] = [];
  for (const mark of marks) {
    if (mark.id !== undefined && mark.target !== undefined)
      open.push({ id: mark.id, target: mark.target });
  }
  return open;
}

function applyOne(mark: TrackedMark, result: Reattached<OpenOverlayMark>, view: ViewRestore): void {
  if (result.orphaned) {
    mark.element = null;
    mark.dot.setState('orphaned');
    mark.bubble.showNote('Orphaned: the marked element is gone');
    return;
  }
  mark.element = result.element;
  const rect = result.element.getBoundingClientRect();
  const offset = mark.offset ?? { x: 0, y: 0 };
  const point = { x: rect.left + offset.x, y: rect.top + offset.y };
  const wasOrphaned =
    mark.dot.element.getAttribute('data-state') === ('orphaned' satisfies DotState);
  mark.dot.moveTo(point);
  mark.bubble.moveTo(point);
  if (wasOrphaned) mark.dot.setState(mark.lastState);
  if (view.kind === 'reset') mark.bubble.showNote(view.message);
}

export function applyReattach(
  marks: readonly TrackedMark[],
  results: readonly Reattached<OpenOverlayMark>[],
  view: ViewRestore,
): void {
  for (const result of results) {
    try {
      const mark = marks.find((candidate) => candidate.id === result.mark.id);
      if (mark !== undefined) applyOne(mark, result, view);
    } catch {
      // the overlay never throws into the host page; the other marks still apply
    }
  }
}
