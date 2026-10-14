import type { Annotation, Rect } from '@passback/schema';

export const ANNOTATION_TOLERANCE = 1;

export type AnnotationCheck =
  { checked: true; holds: boolean; actual: number } | { checked: false };

const UNCHECKED: AnnotationCheck = { checked: false };

function edgeCoordinate(rect: Rect, edge: 'left' | 'right' | 'top' | 'bottom'): number {
  switch (edge) {
    case 'left':
      return rect.x;
    case 'right':
      return rect.x + rect.width;
    case 'top':
      return rect.y;
    case 'bottom':
      return rect.y + rect.height;
  }
}

function overlaps(a: Rect, b: Rect, tolerance: number): boolean {
  const intersectionWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const intersectionHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return intersectionWidth > tolerance && intersectionHeight > tolerance;
}

function countOverlappingPairs(rects: Rect[], tolerance: number): number {
  let count = 0;
  for (const [i, a] of rects.entries()) {
    for (const b of rects.slice(i + 1)) {
      if (overlaps(a, b, tolerance)) count++;
    }
  }
  return count;
}

function resolvePair(
  nameA: string,
  nameB: string,
  rects: Readonly<Record<string, Rect>>,
): { a: Rect; b: Rect } | undefined {
  const a = rects[nameA];
  const b = rects[nameB];
  if (!a || !b) return undefined;
  return { a, b };
}

function resolveList(names: string[], rects: Readonly<Record<string, Rect>>): Rect[] | undefined {
  const resolved: Rect[] = [];
  for (const name of names) {
    const rect = rects[name];
    if (!rect) return undefined;
    resolved.push(rect);
  }
  return resolved;
}

function checkAlign(
  annotation: Extract<Annotation, { type: 'align' }>,
  rects: Readonly<Record<string, Rect>>,
  tolerance: number,
): AnnotationCheck {
  const pair = resolvePair(annotation.a, annotation.b, rects);
  if (!pair) return UNCHECKED;
  const actual = Math.abs(
    edgeCoordinate(pair.a, annotation.edge) - edgeCoordinate(pair.b, annotation.edge),
  );
  return { checked: true, holds: actual <= tolerance, actual };
}

function checkGap(
  annotation: Extract<Annotation, { type: 'gap' }>,
  rects: Readonly<Record<string, Rect>>,
  tolerance: number,
): AnnotationCheck {
  const pair = resolvePair(annotation.a, annotation.b, rects);
  if (!pair) return UNCHECKED;
  const { a, b } = pair;
  const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  const actual = Math.max(dx, dy);
  return { checked: true, holds: Math.abs(actual - annotation.expected) <= tolerance, actual };
}

function checkNoOverlap(
  annotation: Extract<Annotation, { type: 'no-overlap' }>,
  rects: Readonly<Record<string, Rect>>,
  tolerance: number,
): AnnotationCheck {
  if (annotation.elements.length < 2) return UNCHECKED;
  const resolved = resolveList(annotation.elements, rects);
  if (!resolved) return UNCHECKED;
  const actual = countOverlappingPairs(resolved, tolerance);
  return { checked: true, holds: actual === 0, actual };
}

export function checkAnnotation(
  annotation: Annotation,
  rects: Readonly<Record<string, Rect>>,
  tolerance: number = ANNOTATION_TOLERANCE,
): AnnotationCheck {
  switch (annotation.type) {
    case 'align':
      return checkAlign(annotation, rects, tolerance);
    case 'gap':
      return checkGap(annotation, rects, tolerance);
    case 'no-overlap':
      return checkNoOverlap(annotation, rects, tolerance);
    case 'move':
    case 'arrow':
    case 'box':
    case 'label':
      return UNCHECKED;
  }
}
