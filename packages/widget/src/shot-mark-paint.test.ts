// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { paintShot, type PaintCtx, type PaintInput, type ShotMark } from './shot-paint';

type Op = { op: string; fill: unknown; stroke: unknown; width: number; args: unknown[] };

function recording() {
  const ops: Op[] = [];
  const log = (op: string, args: unknown[]) =>
    ops.push({ op, fill: ctx.fillStyle, stroke: ctx.strokeStyle, width: ctx.lineWidth, args });
  const ctx: PaintCtx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    drawImage: (...a: unknown[]) => void log('frame', a),
    fillRect: (...a: number[]) => void log('fillRect', a),
    strokeRect: (...a: number[]) => void log('strokeRect', a),
    beginPath: () => undefined,
    arc: (...a: unknown[]) => void log('arc', a),
    fill: () => undefined,
    fillText: (...a: unknown[]) => void log('fillText', a),
    stroke: () => void log('stroke', []),
  };
  return { ctx, ops };
}

const base = (width: number): PaintInput => ({
  frame: { source: document.createElement('canvas'), width: 1000, height: 500 },
  size: { width, height: width / 2 },
  cssWidth: 1000,
  masks: [{ x: 0, y: 0, width: 10, height: 10 }],
  shapes: [{ tool: 'line', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }],
  makePath: (d) => ({ d }) as unknown as Path2D,
});

const mark = (n: number, current: boolean): ShotMark => ({
  rect: { x: 10, y: 20, width: 100, height: 50 },
  point: { x: 30, y: 40 },
  n,
  current,
});

const hostile = { accent: 'lime', text: 'black' };

describe('shot-mark-paint', () => {
  it('paints red radius-eight badges with white numbers regardless of theme', () => {
    for (const px of [1, 1.5]) {
      const { ctx, ops } = recording();
      paintShot(ctx, {
        ...base(1000 * px),
        marks: [mark(1, true), mark(12, false)],
        colors: hostile,
      });
      const arcs = ops.filter((o) => o.op === 'arc');
      expect(arcs.map((o) => [o.fill, o.args[2]])).toEqual([
        ['#b91c1c', 8 * px],
        ['#b91c1c', 8 * px],
      ]);
      const texts = ops.filter((o) => o.op === 'fillText');
      expect(texts.map((o) => [o.fill, o.args[0]])).toEqual([
        ['#ffffff', '1'],
        ['#ffffff', '12'],
      ]);
      expect(ops.filter((o) => o.op === 'strokeRect').map((o) => o.stroke)).toEqual([
        '#b91c1c',
        '#b91c1c',
      ]);
    }
  });

  it('highlights each element rect before its red outline and numbered badge', () => {
    const px = 1.5;
    const { ctx, ops } = recording();
    paintShot(ctx, { ...base(1500), marks: [mark(1, true), mark(2, false)], colors: hostile });
    expect(ops.map((o) => o.op)).toEqual([
      'frame',
      'fillRect',
      'stroke',
      ...['fillRect', 'strokeRect', 'arc', 'fillText'],
      ...['fillRect', 'strokeRect', 'arc', 'fillText'],
    ]);
    const washes = ops.slice(3).filter((o) => o.op === 'fillRect');
    for (const w of washes) {
      expect(w.fill).toBe('rgba(185, 28, 28, 0.16)');
      expect(w.args).toEqual([10 * px, 20 * px, 100 * px, 50 * px]);
    }
    const outlines = ops.filter((o) => o.op === 'strokeRect');
    for (const o of outlines) {
      expect(o.stroke).toBe('#b91c1c');
      expect(o.args).toEqual([8 * px, 18 * px, 104 * px, 54 * px]);
    }
    expect(outlines.map((o) => o.width)).toEqual([2 * px, 1 * px]);
  });

  it('adds no mark paint when marks are absent or empty', () => {
    const baseline = recording();
    paintShot(baseline.ctx, base(1500));
    expect(baseline.ops.map((o) => o.op)).toEqual(['frame', 'fillRect', 'stroke']);
    for (const marks of [undefined, []]) {
      const { ctx, ops } = recording();
      paintShot(ctx, { ...base(1500), marks, colors: hostile });
      expect(ops).toEqual(baseline.ops);
    }
  });
});
