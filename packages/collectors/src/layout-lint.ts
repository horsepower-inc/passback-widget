import type { Rect } from '@passback/schema';

export type LayoutFinding = { kind: 'overflow-x' | 'overlap'; names: string[] };

function isMeasurable(rect: Rect): boolean {
  return rect.width > 0 && rect.height > 0;
}

function overflowsX(rect: Rect, viewportWidth: number, tolerance: number): boolean {
  return rect.x < -tolerance || rect.x + rect.width > viewportWidth + tolerance;
}

function intersects(a: Rect, b: Rect, tolerance: number): boolean {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > tolerance && height > tolerance;
}

function contains(outer: Rect, inner: Rect, tolerance: number): boolean {
  return (
    outer.x - tolerance <= inner.x &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    outer.y - tolerance <= inner.y &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

function isNesting(a: Rect, b: Rect, tolerance: number): boolean {
  return contains(a, b, tolerance) || contains(b, a, tolerance);
}

function compareNames(a: string[], b: string[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const nameA = a[i] ?? '';
    const nameB = b[i] ?? '';
    if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  }
  return 0;
}

function findOverflowX(
  entries: Array<[string, Rect]>,
  viewportWidth: number,
  tolerance: number,
): LayoutFinding[] {
  return entries
    .filter(([, rect]) => overflowsX(rect, viewportWidth, tolerance))
    .map(([name]) => ({ kind: 'overflow-x' as const, names: [name] }))
    .sort((a, b) => compareNames(a.names, b.names));
}

function findOverlaps(entries: Array<[string, Rect]>, tolerance: number): LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  for (const [nameA, rectA] of entries) {
    for (const [nameB, rectB] of entries) {
      if (nameA >= nameB) continue;
      if (!intersects(rectA, rectB, tolerance)) continue;
      if (isNesting(rectA, rectB, tolerance)) continue;
      findings.push({ kind: 'overlap', names: [nameA, nameB] });
    }
  }
  return findings.sort((a, b) => compareNames(a.names, b.names));
}

export function lintLayout(
  rects: Readonly<Record<string, Rect>>,
  viewport: { width: number; height: number },
  tolerance: number = 1,
): LayoutFinding[] {
  const entries = Object.entries(rects)
    .filter(([, rect]) => isMeasurable(rect))
    .sort(([nameA], [nameB]) => (nameA < nameB ? -1 : nameA > nameB ? 1 : 0));

  return [
    ...findOverflowX(entries, viewport.width, tolerance),
    ...findOverlaps(entries, tolerance),
  ];
}
