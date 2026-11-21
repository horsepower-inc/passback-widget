// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shotMaskRects } from '@passback/collectors/shot-mask';
import { grabViewport, type GrabDeps } from './shot-grab';

vi.mock('@passback/collectors/shot-mask', () => ({ shotMaskRects: vi.fn() }));

function setup() {
  const host = document.createElement('div');
  const source = document.createElement('canvas');
  const render = vi.fn().mockResolvedValue({ source, width: 3840, height: 2400 });
  const ctx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
  };
  const toBlob = vi.fn((cb: BlobCallback) => cb(new Blob(['ok'], { type: 'image/webp' })));
  const canvases: HTMLCanvasElement[] = [];
  const makeCanvas = vi.fn((width: number, height: number) => {
    const canvas = { width, height, getContext: () => ctx, toBlob } as unknown as HTMLCanvasElement;
    canvases.push(canvas);
    return canvas;
  });
  const makePath = vi.fn((d: string) => ({ d }) as unknown as Path2D);
  const deps: GrabDeps = { win: window, host, shapes: [], render, makeCanvas, makePath };
  return { deps, render, source, ctx, toBlob, canvases, makePath };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(shotMaskRects).mockReturnValue([]);
});

describe('shot-grab', () => {
  it('paints the marks it is given with the colours of the host', async () => {
    const { deps, ctx } = setup();
    deps.host.style.setProperty('--pb-color-accent', '#123456');
    deps.marks = [
      {
        rect: { x: 10, y: 20, width: 30, height: 40 },
        point: { x: 12, y: 24 },
        n: 1,
        current: true,
      },
    ];
    await grabViewport(deps);
    const px = 1920 / window.innerWidth;
    expect(ctx.strokeRect).toHaveBeenCalledWith(8 * px, 18 * px, 34 * px, 44 * px);
    expect(ctx.fillText).toHaveBeenCalledWith('1', 12 * px, 24 * px);
  });

  it('scales the canvas to fit 1920 by 1200 and paints the frame, the masks and the shapes', async () => {
    const { deps, ctx, source, canvases, makePath } = setup();
    deps.shapes = [{ tool: 'line', from: { x: 10, y: 20 }, to: { x: 30, y: 40 } }];
    vi.mocked(shotMaskRects).mockReturnValue([{ x: 0, y: 0, width: 10, height: 20 }]);
    await grabViewport(deps);
    expect(canvases[0]).toMatchObject({ width: 1920, height: 1200 });
    expect(ctx.drawImage).toHaveBeenCalledWith(source, 0, 0, 3840, 2400, 0, 0, 1920, 1200);
    const px = 1920 / window.innerWidth;
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, Math.ceil(10 * px), Math.ceil(20 * px));
    expect(makePath).toHaveBeenCalledTimes(1);
    expect(ctx.stroke).toHaveBeenCalledWith(makePath.mock.results[0]?.value);
    expect(ctx.fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.stroke.mock.invocationCallOrder[0]!,
    );
  });

  it('asks for the masks of the whole viewport without the widget host, after the frame arrived', async () => {
    const { deps, render } = setup();
    render.mockImplementation(async () => {
      expect(shotMaskRects).not.toHaveBeenCalled();
      return { source: document.createElement('canvas'), width: 100, height: 80 };
    });
    await grabViewport(deps);
    expect(shotMaskRects).toHaveBeenCalledWith(
      window.document,
      { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      deps.host,
    );
  });

  it('reports image too large when no encoding fits the cap', async () => {
    const { deps, toBlob } = setup();
    toBlob.mockImplementation((cb) =>
      cb(new Blob([new Uint8Array(524289)], { type: 'image/webp' })),
    );
    expect(await grabViewport(deps)).toEqual({ ok: false, reason: 'image too large' });
    expect(toBlob).toHaveBeenCalledTimes(6);
  });

  it('encodes webp first and reports the pixel size of the encoded image and the mask count', async () => {
    const { deps, toBlob, canvases, ctx } = setup();
    const blob = new Blob(['ok'], { type: 'image/png' });
    toBlob.mockImplementation((cb) =>
      cb(
        toBlob.mock.calls.length <= 3
          ? new Blob([new Uint8Array(524289)], { type: 'image/webp' })
          : blob,
      ),
    );
    vi.mocked(shotMaskRects).mockReturnValue([{ x: 0, y: 0, width: 10, height: 10 }]);
    expect(await grabViewport(deps)).toEqual({
      ok: true,
      blob,
      mime: 'image/png',
      width: 960,
      height: 600,
      masked: 1,
    });
    expect(toBlob.mock.calls[0]).toEqual([expect.any(Function), 'image/webp', 0.8]);
    expect(canvases[1]).toMatchObject({ width: 960, height: 600 });
    expect(ctx.drawImage).toHaveBeenLastCalledWith(canvases[0], 0, 0, 960, 600);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(toBlob).toHaveBeenCalledTimes(4);
  });

  it('renders the page without asking for the screen or touching the widget host', async () => {
    const mediaDevices = vi.fn(() => ({ getDisplayMedia: vi.fn() }));
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      get: mediaDevices,
    });
    const writes = vi.fn();
    for (const shotEngine of [undefined, 'dom', 'display']) {
      const { deps, render } = setup();
      Object.defineProperty(deps.host, 'style', {
        value: {
          set visibility(value: string) {
            writes(value);
          },
          get visibility(): string {
            writes('read');
            return '';
          },
        },
      });
      (window as unknown as { __passback?: object }).__passback = { shotEngine };
      expect(await grabViewport(deps)).toMatchObject({ ok: true });
      expect(render).toHaveBeenCalledExactlyOnceWith(window, deps.host);
    }
    delete (window as unknown as { __passback?: object }).__passback;
    expect(mediaDevices).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
  });

  it('reports capture failed when the render, the context, the mask or the encode throws', async () => {
    for (const failure of ['render', 'timeout', 'context', 'mask', 'encode']) {
      const { deps, render, toBlob } = setup();
      if (failure === 'render') render.mockRejectedValue(new Error('boom'));
      if (failure === 'timeout') render.mockRejectedValue(new Error('shot render timed out'));
      if (failure === 'context')
        deps.makeCanvas = () => ({ getContext: () => null }) as unknown as HTMLCanvasElement;
      if (failure === 'mask')
        vi.mocked(shotMaskRects).mockImplementationOnce(() => {
          throw new Error('mask');
        });
      if (failure === 'encode')
        toBlob.mockImplementation(() => {
          throw new Error('encode');
        });
      expect(await grabViewport(deps)).toEqual({ ok: false, reason: 'capture failed' });
    }
  });

  it('local: encodes png and accepts an image up to 2 MiB', async () => {
    const { deps, toBlob } = setup();
    deps.local = true;
    const fits = new Blob([new Uint8Array(2097152)], { type: 'image/png' });
    toBlob.mockImplementation((cb) => cb(fits));
    expect(await grabViewport(deps)).toMatchObject({
      ok: true,
      blob: fits,
      mime: 'image/png',
      width: 1920,
      height: 1200,
    });
    expect(toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'image/png', 0.8);
    toBlob.mockClear();
    toBlob.mockImplementation((cb) =>
      cb(new Blob([new Uint8Array(2097153)], { type: 'image/png' })),
    );
    expect(await grabViewport(deps)).toEqual({ ok: false, reason: 'image too large' });
    expect(toBlob).toHaveBeenCalledTimes(2);
  });
});
