import { shapePath, SHAPE_INK, SHAPE_STROKE, type Shape } from './shot-shapes';

export const SHOT_VIEW_MAX_WIDTH = 1920;
export const SHOT_VIEW_MAX_HEIGHT = 1200;
export type Frame = { source: CanvasImageSource; width: number; height: number };
export type MaskBox = { x: number; y: number; width: number; height: number };
export type PaintCtx = Pick<CanvasRenderingContext2D, 'drawImage' | 'fillRect' | 'stroke'> & {
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
  makePath?(d: string): Path2D;
};

export function frameScale(frame: { width: number; height: number }): number {
  return Math.min(1, SHOT_VIEW_MAX_WIDTH / frame.width, SHOT_VIEW_MAX_HEIGHT / frame.height);
}

export function paintShot(ctx: PaintCtx, input: PaintInput): void {
  const { frame, size, cssWidth, masks, shapes, makePath = (d) => new Path2D(d) } = input;
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
}
