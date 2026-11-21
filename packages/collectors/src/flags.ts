import type { Visual } from '@passback/schema';
import { collectContrast } from './contrast';

const CLIP_OVERFLOWS = new Set(['hidden', 'clip', 'auto', 'scroll']);
const TOLERANCE = 1;

function isOwnClipped(el: Element): boolean {
  const style = getComputedStyle(el);
  const clipsX = style.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + TOLERANCE;
  const clipsY = style.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + TOLERANCE;
  return clipsX || clipsY;
}

function escapesHorizontally(outer: DOMRect, inner: DOMRect): boolean {
  return outer.left - TOLERANCE > inner.left || outer.right + TOLERANCE < inner.right;
}

function escapesVertically(outer: DOMRect, inner: DOMRect): boolean {
  return outer.top - TOLERANCE > inner.top || outer.bottom + TOLERANCE < inner.bottom;
}

function isClippedByAncestor(el: Element): boolean {
  const elRect = el.getBoundingClientRect();
  let current = el.parentElement;
  while (current) {
    const style = getComputedStyle(current);
    const ancestorRect = current.getBoundingClientRect();
    const clipsX = CLIP_OVERFLOWS.has(style.overflowX) && escapesHorizontally(ancestorRect, elRect);
    const clipsY = CLIP_OVERFLOWS.has(style.overflowY) && escapesVertically(ancestorRect, elRect);
    if (clipsX || clipsY) return true;
    current = current.parentElement;
  }
  return false;
}

function isClipped(el: Element): boolean {
  return isOwnClipped(el) || isClippedByAncestor(el);
}

function viewportSize(): { width: number; height: number } {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  };
}

function coveredPoints(rect: DOMRect): Array<{ x: number; y: number }> {
  return [
    { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    { x: rect.left + TOLERANCE, y: rect.top + TOLERANCE },
    { x: rect.right - TOLERANCE, y: rect.top + TOLERANCE },
    { x: rect.left + TOLERANCE, y: rect.bottom - TOLERANCE },
    { x: rect.right - TOLERANCE, y: rect.bottom - TOLERANCE },
  ];
}

type DocumentWithElementsFromPoint = Document & {
  elementsFromPoint?: (x: number, y: number) => Element[];
};

function elementsStackAt(x: number, y: number): Element[] | undefined {
  const doc = document as DocumentWithElementsFromPoint;
  return typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint(x, y) : undefined;
}

function isObstruction(candidate: Element, el: Element): boolean {
  return !el.contains(candidate) && !candidate.contains(el);
}

function frontElements(hits: Element[], el: Element): Element[] {
  const index = hits.indexOf(el);
  return index === -1 ? [] : hits.slice(0, index);
}

function isCoveredAtPoint(x: number, y: number, el: Element): boolean {
  const stack = elementsStackAt(x, y);
  if (stack) return frontElements(stack, el).some((hit) => isObstruction(hit, el));
  const hit = document.elementFromPoint(x, y);
  return hit ? isObstruction(hit, el) : false;
}

function isCovered(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const { width, height } = viewportSize();

  return coveredPoints(rect).some(({ x, y }) => {
    if (x < 0 || x > width || y < 0 || y > height) return false;
    return isCoveredAtPoint(x, y, el);
  });
}

function isOffViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  const { width } = viewportSize();
  return rect.left < -TOLERANCE || rect.right > width + TOLERANCE;
}

export function collectFlags(el: Element): Visual['flags'] {
  const flags: Visual['flags'] = {
    clipped: isClipped(el),
    covered: isCovered(el),
    offViewport: isOffViewport(el),
  };

  const contrast = collectContrast(el);
  if (contrast !== undefined) flags.contrast = contrast;

  return flags;
}
