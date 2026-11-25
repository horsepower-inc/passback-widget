// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { mountInk, type Ink } from './shot-ink';
import { mountVeil } from './shot-veil';
import { mountTools } from './shot-tools';
import { grabViewport } from './shot-grab';
import { uploadShot } from './shot-upload';
import type { Shape } from './shot-shapes';
import { openShot } from './shot';
import { MAX_PASS_HEIGHT, renderFrame } from './shot-dom';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));
vi.mock('./shot-ink', () => ({ mountInk: vi.fn() }));
vi.mock('./shot-veil', () => ({ mountVeil: vi.fn() }));
vi.mock('./shot-tools', () => ({ mountTools: vi.fn() }));
vi.mock('./shot-grab', () => ({ grabViewport: vi.fn() }));
vi.mock('./shot-upload', () => ({ uploadShot: vi.fn() }));

const VH = 800;
const box = (y: number): Shape => ({ tool: 'box', from: { x: 100, y }, to: { x: 160, y: y + 60 } });
let shapes: readonly Shape[];

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, 'innerHeight', { value: VH, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: 6000, configurable: true });
  const ink = {
    tool: 'box',
    shapes: () => shapes,
    setActive: vi.fn(),
    destroy: vi.fn(),
    undo: vi.fn(),
    clear: vi.fn(),
  } as unknown as Ink;
  vi.mocked(mountInk).mockImplementation(() => ink);
  vi.mocked(mountVeil).mockReturnValue({ refresh: vi.fn(), destroy: vi.fn() });
  vi.mocked(mountTools).mockReturnValue({
    element: document.createElement('div'),
    setCount: vi.fn(),
    destroy: vi.fn(),
  });
  vi.mocked(grabViewport).mockResolvedValue({
    ok: true,
    blob: new Blob(['p']),
    mime: 'image/webp',
    width: 800,
    height: 600,
    masked: 0,
  });
  vi.mocked(uploadShot).mockResolvedValue({
    ok: true,
    screenshot: {
      id: 'a'.repeat(32),
      mime: 'image/webp',
      width: 800,
      height: 600,
      masked: 0,
      bytes: 1,
    },
  });
});

describe('a tall span of drawings', () => {
  it('a tall span is cut to three viewport heights centred on the marked element and counted in the note', async () => {
    shapes = [box(-4000), box(1000), box(300), box(5000)];
    const el = document.createElement('div');
    document.body.append(el);
    el.getBoundingClientRect = () => ({ left: 0, top: 900, bottom: 1100, right: 50 }) as DOMRect;
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const session = openShot({ win: window, root, host, uploadUrl: '/s', fetchFn: vi.fn() });
    const outcome = await session.finish(el);
    const { region } = vi.mocked(grabViewport).mock.calls[0]![0];
    expect(region).toEqual({ top: 1000 - 1.5 * VH, height: 3 * VH });
    // The shapes at -4000 and 5000 lie wholly outside the picture.
    expect(outcome.note).toBe('2 drawings outside the picture');
    expect(outcome.annotations).toHaveLength(4);
  });

  it('a band over the single-pass limit is rendered in slices without a gap', async () => {
    const calls: { height: number; margin: string }[] = [];
    vi.mocked(toCanvas).mockImplementation((async (
      _n: unknown,
      o: { height: number; style: { margin: string } },
    ) => {
      calls.push({ height: o.height, margin: o.style.margin });
      return { width: 800, height: o.height } as HTMLCanvasElement;
    }) as never);
    const draws: [number, number][] = [];
    const joined = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (src: { height: number }, _x: number, y: number) => draws.push([y, src.height]),
      }),
    } as unknown as HTMLCanvasElement;
    const height = 2 * MAX_PASS_HEIGHT + 500;
    const frame = await renderFrame(
      window,
      document.createElement('div'),
      { top: -100, height },
      () => joined,
    );
    expect(calls.map((c) => c.height)).toEqual([MAX_PASS_HEIGHT, MAX_PASS_HEIGHT, 500]);
    const tops = calls.map((c) => -Number.parseFloat(c.margin) - 6000);
    expect(tops).toEqual([-100, -100 + MAX_PASS_HEIGHT, -100 + 2 * MAX_PASS_HEIGHT]);
    expect(draws).toEqual([
      [0, MAX_PASS_HEIGHT],
      [MAX_PASS_HEIGHT, MAX_PASS_HEIGHT],
      [2 * MAX_PASS_HEIGHT, 500],
    ]);
    expect(frame.height).toBe(height);
  });

  it('the element budget is judged per slice, not for the whole band', async () => {
    const real = await vi.importActual<typeof import('./shot-grab')>('./shot-grab');
    const seen: number[] = [];
    const render = vi.fn(async () => ({ source: {} as CanvasImageSource, width: 800, height: 10 }));
    await real.grabViewport({
      win: window,
      host: document.createElement('div'),
      shapes: [],
      region: { top: 0, height: 2 * MAX_PASS_HEIGHT + 500 },
      overBudget: (_w, _h, view) => (seen.push(view.height), false),
      render,
      makeCanvas: () => {
        throw new Error('stop');
      },
    });
    expect(seen).toEqual([MAX_PASS_HEIGHT, MAX_PASS_HEIGHT, 500]);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
