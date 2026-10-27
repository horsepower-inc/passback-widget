// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  colorsOf,
  frameScale,
  marksOf,
  paintShot,
  type ShotMark,
  type PaintCtx,
  type PaintInput,
} from './shot-paint';

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
    strokeRect: (...args: number[]) => {
      calls.push(['outline', ctx.strokeStyle, ctx.lineWidth, ...args]);
    },
    beginPath: () => undefined,
    arc: (...args: (number | boolean | undefined)[]) => {
      calls.push(['badge', ctx.fillStyle, ...args]);
    },
    fill: () => undefined,
    fillText: (...args: unknown[]) => {
      calls.push(['number', ctx.fillStyle, ctx.font, ctx.textAlign, ctx.textBaseline, ...args]);
    },
    font: '',
    textAlign: '',
    textBaseline: '',
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

  const mark = (n: number, current: boolean): ShotMark => ({
    rect: { x: 10, y: 20, width: 100, height: 50 },
    point: { x: 30, y: 40 },
    n,
    current,
  });
  const colors = { accent: '#0a0', text: '#fff' };

  it('paints the outline and number of each mark', () => {
    const { ctx, calls } = recording();
    paintShot(ctx, {
      ...input(),
      shapes: [{ tool: 'line', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }],
      marks: [mark(2, true)],
      colors,
    });
    const px = 1.5;
    expect(calls.map((c) => c[0])).toEqual([
      'frame',
      'shape',
      'mask',
      'outline',
      'badge',
      'number',
    ]);
    expect(calls[2]).toEqual(['mask', 'rgba(185, 28, 28, 0.16)', 15, 30, 150, 75]);
    expect(calls[3]).toEqual(['outline', '#b91c1c', 2 * px, 8 * px, 18 * px, 104 * px, 54 * px]);
    expect(calls[4]).toEqual(['badge', '#b91c1c', 30 * px, 40 * px, 8 * px, 0, Math.PI * 2]);
    expect(calls[5]).toEqual([
      'number',
      '#ffffff',
      `bold ${11 * px}px sans-serif`,
      'center',
      'middle',
      '2',
      30 * px,
      40 * px,
    ]);
  });

  it('draws the current mark solid and the others thinner', () => {
    const { ctx, calls } = recording();
    paintShot(ctx, { ...input(), marks: [mark(1, true), mark(2, false)], colors });
    const widths = calls.filter((c) => c[0] === 'outline').map((c) => c[2]);
    expect(widths).toEqual([3, 1.5]);
  });

  it('turns a pin into the element box, the point and the number', () => {
    const element = document.createElement('div');
    document.body.append(element);
    element.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 100, height: 50, right: 110, bottom: 70 }) as DOMRect;
    expect(marksOf([{ element, offset: { x: 5, y: 6 }, n: 3, current: false }], window)).toEqual([
      {
        rect: { x: 10, y: 20, width: 100, height: 50 },
        point: { x: 15, y: 26 },
        n: 3,
        current: false,
      },
    ]);
    element.remove();
  });

  it('leaves out a mark whose element is outside the viewport', () => {
    const at = (left: number, top: number, connected = true) => {
      const element = document.createElement('div');
      if (connected) document.body.append(element);
      element.getBoundingClientRect = () =>
        ({ left, top, width: 10, height: 10, right: left + 10, bottom: top + 10 }) as DOMRect;
      return { element, offset: { x: 0, y: 0 }, n: 1, current: true };
    };
    const pins = [
      at(-10, 0),
      at(0, -10),
      at(window.innerWidth, 0),
      at(0, window.innerHeight),
      at(5, 5, false),
    ];
    expect(marksOf(pins, window)).toEqual([]);
    expect(marksOf([at(-5, -5)], window)).toHaveLength(1);
    document.body.innerHTML = '';
  });

  it('reads the accent and text colours from the host and falls back to the light theme', () => {
    const host = document.createElement('div');
    document.body.append(host);
    expect(colorsOf(window, host)).toEqual({ accent: '#2f6bff', text: '#ffffff' });
    host.style.setProperty('--pb-color-accent', ' #111111 ');
    expect(colorsOf(window, host)).toEqual({ accent: '#111111', text: '#ffffff' });
    host.style.setProperty('--pb-color-on-main', '#222222');
    expect(colorsOf(window, host)).toEqual({ accent: '#111111', text: '#222222' });
    host.remove();
  });
});
