import type { Visual } from '@passback/schema';
import { toRect } from './rects';

export interface FontMetrics {
  readonly ascent: number;
  readonly descent: number;
}

export type MeasureFont = (font: string) => FontMetrics | undefined;

export function canvasMeasureFont(doc: Document): MeasureFont {
  let ctx: CanvasRenderingContext2D | null | undefined;

  return (font: string): FontMetrics | undefined => {
    if (ctx === undefined) {
      ctx = doc.createElement('canvas').getContext('2d');
    }
    if (!ctx) return undefined;

    ctx.font = font;
    const metrics = ctx.measureText('Hg');
    return { ascent: metrics.fontBoundingBoxAscent, descent: metrics.fontBoundingBoxDescent };
  };
}

interface Fragment {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dropEmpty(rects: ArrayLike<DOMRect>): Fragment[] {
  const fragments: Fragment[] = [];
  for (const r of Array.from(rects)) {
    if (r.width === 0 || r.height === 0) continue;
    fragments.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return fragments;
}

// A merge can only narrow this window (intersection of merged tops/bottoms), never widen it,
// so folding a fragment into a line can't make the line a looser match for the next fragment.
const LINE_ALIGNMENT_OVERLAP_RATIO = 0.5;

function isSameLine(alignTop: number, alignBottom: number, top: number, bottom: number): boolean {
  const overlap = Math.min(alignBottom, bottom) - Math.max(alignTop, top);
  if (overlap <= 0) return false;
  const minHeight = Math.min(alignBottom - alignTop, bottom - top);
  return minHeight > 0 && overlap / minHeight >= LINE_ALIGNMENT_OVERLAP_RATIO;
}

interface Line extends Fragment {
  alignTop: number;
  alignBottom: number;
}

function mergeLines(fragments: Fragment[]): Fragment[] {
  const sorted = [...fragments].sort((a, b) => a.top - b.top);
  const lines: Line[] = [];
  for (const frag of sorted) {
    const last = lines[lines.length - 1];
    if (last && isSameLine(last.alignTop, last.alignBottom, frag.top, frag.bottom)) {
      last.left = Math.min(last.left, frag.left);
      last.right = Math.max(last.right, frag.right);
      last.top = Math.min(last.top, frag.top);
      last.bottom = Math.max(last.bottom, frag.bottom);
      last.alignTop = Math.max(last.alignTop, frag.top);
      last.alignBottom = Math.min(last.alignBottom, frag.bottom);
    } else {
      lines.push({ ...frag, alignTop: frag.top, alignBottom: frag.bottom });
    }
  }
  return lines.map(({ left, top, right, bottom }) => ({ left, top, right, bottom }));
}

function computeFont(el: Element): string {
  const style = getComputedStyle(el);
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

function textNodes(node: Node): Text[] {
  const nodes: Text[] = [];
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      nodes.push(child as Text);
    } else {
      nodes.push(...textNodes(child));
    }
  }
  return nodes;
}

export function collectText(el: Element, measure?: MeasureFont): Visual['text'] {
  if (!(el.textContent ?? '').trim()) return undefined;

  const range = el.ownerDocument.createRange();
  const fragments = textNodes(el).flatMap((node) => {
    range.selectNodeContents(node);
    return dropEmpty(range.getClientRects());
  });
  const [firstFragment, ...restFragments] = mergeLines(fragments);
  if (!firstFragment) return undefined;

  const lines = [firstFragment, ...restFragments].map((f) =>
    toRect({ x: f.left, y: f.top, width: f.right - f.left, height: f.bottom - f.top }),
  );

  const font = computeFont(el);
  const measureFont = measure ?? canvasMeasureFont(el.ownerDocument);
  const metrics = measureFont(font);
  const fontSize = parseFloat(getComputedStyle(el).fontSize);
  const ascent = metrics?.ascent ?? fontSize * 0.8;
  const descent = metrics?.descent ?? fontSize * 0.2;

  return { lines, baseline: round2(firstFragment.top + ascent), ascent, descent };
}
