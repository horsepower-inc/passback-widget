import type { Offset } from '@passback/schema';
import { shapePath, SHAPE_INK, SHAPE_STROKE, type Shape } from './shot-shapes';

export const SHOT_VIEW_MAX_WIDTH = 1920;
export const SHOT_VIEW_MAX_HEIGHT = 1200;
export type Frame = { source: CanvasImageSource; width: number; height: number };
export type MaskBox = { x: number; y: number; width: number; height: number };
export type ShotPin = { element: Element; offset: Offset; n: number; current: boolean };
export type ShotMark = {
  rect: MaskBox;
  point: { x: number; y: number };
  n: number;
  current: boolean;
};
export type MarkColors = { accent: string; text: string };
export type PaintCtx = Pick<
  CanvasRenderingContext2D,
  'drawImage' | 'fillRect' | 'stroke' | 'strokeRect' | 'beginPath' | 'arc' | 'fill' | 'fillText'
> & {
  font: string;
  textAlign: unknown;
  textBaseline: unknown;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: unknown;
  lineJoin: unknown;
};
export type PaintInput = {
  frame: Frame;
  size: { width: number; height: number };
  cssWidth: number;
  masks: readonly MaskBox[];
  shapes: readonly Shape[];
  marks?: readonly ShotMark[];
  colors?: MarkColors;
  makePath?(d: string): Path2D;
};

export function frameScale(frame: { width: number; height: number }): number {
  return Math.min(1, SHOT_VIEW_MAX_WIDTH / frame.width, SHOT_VIEW_MAX_HEIGHT / frame.height);
}

export function marksOf(pins: readonly ShotPin[], win: Window): ShotMark[] {
  const marks: ShotMark[] = [];
  for (const { element, offset, n, current } of pins) {
    if (!element.isConnected) continue;
    const r = element.getBoundingClientRect();
    if (r.right <= 0 || r.bottom <= 0 || r.left >= win.innerWidth || r.top >= win.innerHeight)
      continue;
    const rect = { x: r.left, y: r.top, width: r.width, height: r.height };
    marks.push({ rect, point: { x: r.left + offset.x, y: r.top + offset.y }, n, current });
  }
  return marks;
}

export function colorsOf(win: Window, host: HTMLElement): MarkColors {
  const style = win.getComputedStyle(host);
  const read = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    accent: read('--pb-color-accent', '#2f6bff'),
    text: read('--pb-color-on-main', '#ffffff'),
  };
}

export const MARK_RED = '#b91c1c';
const MARK_WASH = 'rgba(185, 28, 28, 0.16)';
const MARK_INK = '#ffffff';

function paintMarks(ctx: PaintCtx, marks: readonly ShotMark[], px: number): void {
  for (const { rect, point, n, current } of marks) {
    ctx.fillStyle = MARK_WASH;
    ctx.fillRect(rect.x * px, rect.y * px, rect.width * px, rect.height * px);
    ctx.strokeStyle = MARK_RED;
    ctx.lineWidth = (current ? 2 : 1) * px;
    ctx.strokeRect(
      (rect.x - 2) * px,
      (rect.y - 2) * px,
      (rect.width + 4) * px,
      (rect.height + 4) * px,
    );
    ctx.fillStyle = MARK_RED;
    ctx.beginPath();
    ctx.arc(point.x * px, point.y * px, 8 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = MARK_INK;
    ctx.font = `bold ${11 * px}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), point.x * px, point.y * px);
  }
}

export function paintShot(ctx: PaintCtx, input: PaintInput): void {
  const { frame, size, cssWidth, masks, shapes, marks, makePath = (d) => new Path2D(d) } = input;
  ctx.drawImage(frame.source, 0, 0, frame.width, frame.height, 0, 0, size.width, size.height);
  const px = size.width / cssWidth;
  ctx.fillStyle = '#000';
  for (const { x, y, width, height } of masks) {
    ctx.fillRect(
      Math.floor(x * px),
      Math.floor(y * px),
      Math.ceil(width * px),
      Math.ceil(height * px),
    );
  }
  ctx.strokeStyle = SHAPE_INK;
  ctx.lineWidth = SHAPE_STROKE * px;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const shape of shapes) ctx.stroke(makePath(shapePath(shape, px)));
  if (marks?.length) paintMarks(ctx, marks, px);
}
