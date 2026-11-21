import type { Rect, Visual } from '@passback/schema';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function toRect(r: { x: number; y: number; width: number; height: number }): Rect {
  return {
    x: round2(r.x),
    y: round2(r.y),
    width: round2(r.width),
    height: round2(r.height),
  };
}

function findPositionedAncestor(el: Element): Element | null {
  let current = el.parentElement;
  while (current) {
    const position = getComputedStyle(current).position;
    if (position && position !== 'static') return current;
    current = current.parentElement;
  }
  return null;
}

export function collectRects(el: Element): Visual['rects'] {
  const parentEl = el.parentElement ?? el;
  const rects: Visual['rects'] = {
    self: toRect(el.getBoundingClientRect()),
    parent: toRect(parentEl.getBoundingClientRect()),
  };

  if (el.previousElementSibling)
    rects.prev = toRect(el.previousElementSibling.getBoundingClientRect());
  if (el.nextElementSibling) rects.next = toRect(el.nextElementSibling.getBoundingClientRect());

  const positioned = findPositionedAncestor(el);
  if (positioned) rects.positioned = toRect(positioned.getBoundingClientRect());

  return rects;
}
