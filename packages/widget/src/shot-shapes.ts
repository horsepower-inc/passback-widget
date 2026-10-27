// The drawn shapes as pure arithmetic: what a shape is, when a stroke counts,
// undo, the scroll shift, and one outline both the SVG layer and the canvas draw.
export const SHAPE_MIN = 6;
export const SHAPE_MAX = 20;
export const SHAPE_STROKE = 3;
export const SHAPE_HEAD = 9;
export const SHAPE_INK = '#e5261f';

export type Tool = 'arrow' | 'line' | 'box';
export type Pt = { x: number; y: number };
export type Shape = { tool: Tool; from: Pt; to: Pt };

export function acceptShape(shape: Shape): boolean {
  const { from, to } = shape;
  return Math.hypot(to.x - from.x, to.y - from.y) >= SHAPE_MIN;
}

export function pushShape(list: readonly Shape[], shape: Shape): readonly Shape[] {
  if (!acceptShape(shape) || list.length >= SHAPE_MAX) return list;
  return [...list, shape];
}

export function undoShape(list: readonly Shape[]): readonly Shape[] {
  return list.slice(0, -1);
}

export function shiftShapes(list: readonly Shape[], dx: number, dy: number): readonly Shape[] {
  if (dx === 0 && dy === 0) return list;
  const move = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  return list.map((s) => ({ tool: s.tool, from: move(s.from), to: move(s.to) }));
}

function r(n: number): number {
  return Math.round(n * 10) / 10;
}

function wings(a: Pt, b: Pt, k: number): string {
  const { x: x2, y: y2 } = b;
  const t = Math.atan2(y2 - a.y, x2 - a.x);
  const L = SHAPE_HEAD * k;
  return [-0.5, 0.5]
    .map((d) => `M${r(x2)} ${r(y2)}L${r(x2 - L * Math.cos(t + d))} ${r(y2 - L * Math.sin(t + d))}`)
    .join('');
}

export function shapePath(shape: Shape, k = 1): string {
  const x1 = shape.from.x * k;
  const y1 = shape.from.y * k;
  const x2 = shape.to.x * k;
  const y2 = shape.to.y * k;
  if (shape.tool === 'box') {
    const [minX, maxX] = [Math.min(x1, x2), Math.max(x1, x2)];
    const [minY, maxY] = [Math.min(y1, y2), Math.max(y1, y2)];
    return `M${r(minX)} ${r(minY)}H${r(maxX)}V${r(maxY)}H${r(minX)}Z`;
  }
  const line = `M${r(x1)} ${r(y1)}L${r(x2)} ${r(y2)}`;
  return shape.tool === 'arrow' ? line + wings({ x: x1, y: y1 }, { x: x2, y: y2 }, k) : line;
}
