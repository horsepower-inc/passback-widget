import type { RectSnapshot } from '@passback/collectors/geometry';

type Rect = RectSnapshot['rects'][string];

// Serialised by Playwright through page.evaluate: self-contained, no runtime imports.
export function collectPageRects(): Record<string, Rect> {
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  const nameOf = (el: Element): string => {
    const testid = el.getAttribute('data-testid');
    if (testid) return testid;
    const id = el.getAttribute('id');
    return id ? '#' + id : '';
  };
  const rects: Record<string, Rect> = {};
  const seen: Record<string, number> = {};
  for (const el of Array.from(document.querySelectorAll('[data-testid], [id]'))) {
    const base = nameOf(el);
    if (!base) continue;
    seen[base] = (seen[base] ?? 0) + 1;
    const name = seen[base] === 1 ? base : base + '~' + seen[base];
    const r = el.getBoundingClientRect();
    rects[name] = {
      x: round2(r.x),
      y: round2(r.y),
      width: round2(r.width),
      height: round2(r.height),
    };
  }
  return rects;
}
