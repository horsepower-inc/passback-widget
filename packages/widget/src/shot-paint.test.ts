// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { frameScale, paintShot, type PaintCtx, type PaintInput } from './shot-paint';

function recording() {
  const calls: unknown[][] = [];
  const ctx: PaintCtx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    drawImage: (...args: unknown[]) => {
      calls.push(['frame', ...args]);
    },
    fillRect: (...args: number[]) => {
      calls.push(['mask', ctx.fillStyle, ...args]);
    },
    stroke: (path?: Path2D) => {
      calls.push(['shape', ctx.strokeStyle, ctx.lineWidth, ctx.lineCap, ctx.lineJoin, path]);
    },
  };
  return { ctx, calls };
}

function input(): PaintInput {
  return {
    frame: { source: document.createElement('canvas'), width: 3840, height: 2160 },
    size: { width: 1920, height: 1080 },
    cssWidth: 1280,
    masks: [],
    shapes: [],
    makePath: (d) => ({ d }) as unknown as Path2D,
  };
}

describe('shot-paint', () => {
  it('scales a frame down to fit 1920 by 1200 and never enlarges it', () => {
    const cases: [number, number, number][] = [
      [2560, 1440, 0.75],
      [1920, 1080, 1],
      [1280, 720, 1],
      [3840, 2160, 0.5],
      [1280, 2000, 0.6],
    ];
    for (const [width, height, scale] of cases) expect(frameScale({ width, height })).toBe(scale);
  });

  it('draws the whole frame onto the whole canvas', () => {
    const { ctx, calls } = recording();
    const value = input();
    paintShot(ctx, value);
    expect(calls[0]).toEqual(['frame', value.frame.source, 0, 0, 3840, 2160, 0, 0, 1920, 1080]);
  });

  it('paints a black box over each mask, scaled and rounded outward', () => {
    const { ctx, calls } = recording();
    paintShot(ctx, {
      ...input(),
      masks: [
        { x: 1.1, y: 2.1, width: 3.1, height: 4.1 },
        { x: -1.1, y: 10, width: 2, height: 3 },
      ],
    });
    expect(calls.slice(1)).toEqual([
      ['mask', '#000', 1, 3, 5, 7],
      ['mask', '#000', -2, 15, 3, 5],
    ]);
  });

  it('strokes each shape in the ink colour with the stroke scaled to the canvas', () => {
    const { ctx, calls } = recording();
    paintShot(ctx, {
      ...input(),
      shapes: [
        { tool: 'line', from: { x: 10, y: 20 }, to: { x: 30, y: 40 } },
        { tool: 'box', from: { x: 20, y: 30 }, to: { x: 10, y: 10 } },
        { tool: 'arrow', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
      ],
    });
    expect(calls.slice(1)).toEqual([
      ['shape', '#e5261f', 4.5, 'round', 'round', { d: 'M15 30L45 60' }],
      ['shape', '#e5261f', 4.5, 'round', 'round', { d: 'M15 15H30V45H15Z' }],
      [
        'shape',
        '#e5261f',
        4.5,
        'round',
        'round',
        { d: 'M0 0L150 0M150 0L138.2 6.5M150 0L138.2 -6.5' },
      ],
    ]);
  });

  it('paints the masks before the shapes', () => {
    const { ctx, calls } = recording();
    paintShot(ctx, {
      ...input(),
      masks: [{ x: 0, y: 0, width: 10, height: 10 }],
      shapes: [{ tool: 'line', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } }],
    });
    expect(calls.map((call) => call[0])).toEqual(['frame', 'mask', 'shape']);
  });

  it('paints nothing more than the frame when there are no masks and no shapes', () => {
    const { ctx, calls } = recording();
    const value = input();
    delete value.makePath;
    paintShot(ctx, value);
    expect(calls).toEqual([['frame', value.frame.source, 0, 0, 3840, 2160, 0, 0, 1920, 1080]]);
  });
});
