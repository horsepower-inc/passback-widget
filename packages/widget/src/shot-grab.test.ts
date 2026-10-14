// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shotMaskRects } from '@passback/collectors/shot-mask';
import { grabViewport, type GrabDeps } from './shot-grab';

vi.mock('@passback/collectors/shot-mask', () => ({ shotMaskRects: vi.fn() }));

function setup(surface?: string) {
  const tracks = [
    { getSettings: () => ({ displaySurface: surface }), stop: vi.fn() },
    { stop: vi.fn() },
  ];
  const stream = {
    getVideoTracks: () => [tracks[0]],
    getTracks: () => tracks,
  } as unknown as MediaStream;
  const prompt = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia: prompt },
  });
  const host = document.createElement('div');
  host.style.visibility = 'visible';
  const source = document.createElement('canvas');
  const frame = vi.fn().mockResolvedValue({ source, width: 3840, height: 2400 });
  const ctx = { drawImage: vi.fn(), fillRect: vi.fn(), stroke: vi.fn() };
  const toBlob = vi.fn((cb: BlobCallback) => cb(new Blob(['ok'], { type: 'image/webp' })));
  const canvases: HTMLCanvasElement[] = [];
  const makeCanvas = vi.fn((width: number, height: number) => {
    const canvas = { width, height, getContext: () => ctx, toBlob } as unknown as HTMLCanvasElement;
    canvases.push(canvas);
    return canvas;
  });
  const makePath = vi.fn((d: string) => ({ d }) as unknown as Path2D);
  const deps: GrabDeps = { win: window, host, shapes: [], frame, makeCanvas, makePath };
  return { deps, tracks, prompt, frame, source, ctx, toBlob, canvases, makePath };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(shotMaskRects).mockReturnValue([]);
});

describe('shot-grab', () => {
  it('reports unsupported browser when getDisplayMedia is missing and hides nothing', async () => {
    const { deps, frame } = setup();
    Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: {} });
    expect(await grabViewport(deps)).toEqual({ ok: false, reason: 'unsupported browser' });
    expect(deps.host.style.visibility).toBe('visible');
    expect(frame).not.toHaveBeenCalled();
  });

  it('reports permission denied when the prompt is refused and shows the widget again', async () => {
    for (const name of ['NotAllowedError', 'AbortError', 'UnknownError']) {
      const { deps, prompt } = setup();
      prompt.mockRejectedValue({ name });
      expect(await grabViewport(deps)).toEqual({
        ok: false,
        reason: name === 'UnknownError' ? 'capture failed' : 'permission denied',
      });
      expect(deps.host.style.visibility).toBe('visible');
    }
  });

  it('reports another window was shared when displaySurface is not browser', async () => {
    const { deps, frame, tracks } = setup('window');
    expect(await grabViewport(deps)).toEqual({ ok: false, reason: 'another window was shared' });
    expect(frame).not.toHaveBeenCalled();
    for (const track of tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(deps.host.style.visibility).toBe('visible');
  });

  it('hides the widget host before asking and restores its visibility after', async () => {
    const { deps, prompt, frame } = setup();
    deps.host.style.visibility = 'collapse';
    prompt.mockImplementation(async () => {
      expect(deps.host.style.visibility).toBe('hidden');
      return { getVideoTracks: () => [], getTracks: () => [] };
    });
    frame.mockImplementation(async () => {
      expect(deps.host.style.visibility).toBe('hidden');
      return { source: document.createElement('canvas'), width: 100, height: 80 };
    });
    expect((await grabViewport(deps)).ok).toBe(true);
    expect(prompt).toHaveBeenCalledWith({ video: true, preferCurrentTab: true });
    expect(deps.host.style.visibility).toBe('collapse');
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
    const { deps, frame } = setup();
    frame.mockImplementation(async () => {
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

  it('stops every track after a successful grab and after a failure', async () => {
    for (const failure of ['none', 'frame', 'context', 'encode', 'mask', 'stop']) {
      const { deps, frame, tracks, toBlob } = setup();
      if (failure === 'frame') frame.mockRejectedValue(new Error('frame'));
      if (failure === 'context')
        deps.makeCanvas = () => ({ getContext: () => null }) as unknown as HTMLCanvasElement;
      if (failure === 'encode')
        toBlob.mockImplementation(() => {
          throw new Error('encode');
        });
      if (failure === 'mask')
        vi.mocked(shotMaskRects).mockImplementationOnce(() => {
          throw new Error('mask');
        });
      if (failure === 'stop')
        tracks[0]!.stop.mockImplementation(() => {
          throw new Error('stop');
        });
      const result = await grabViewport(deps);
      expect(result).toMatchObject(
        failure === 'none' ? { ok: true } : { ok: false, reason: 'capture failed' },
      );
      for (const track of tracks) expect(track.stop).toHaveBeenCalledTimes(1);
      expect(deps.host.style.visibility).toBe('visible');
    }
  });

  it('reports image too large when no encoding fits the cap', async () => {
    const { deps, toBlob, tracks } = setup();
    toBlob.mockImplementation((cb) =>
      cb(new Blob([new Uint8Array(524289)], { type: 'image/webp' })),
    );
    expect(await grabViewport(deps)).toEqual({ ok: false, reason: 'image too large' });
    expect(toBlob).toHaveBeenCalledTimes(6);
    for (const track of tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(deps.host.style.visibility).toBe('visible');
  });

  it('encodes webp first and reports the pixel size of the encoded image and the mask count', async () => {
    const { deps, toBlob, canvases, ctx } = setup(undefined);
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

  it('local: encodes png and accepts an image up to 2 MiB', async () => {
    const { deps, toBlob } = setup();
    deps.local = true;
    const fits = new Blob([new Uint8Array(2097152)], { type: 'image/png' });
    toBlob.mockImplementation((cb) => cb(fits));
    expect(await grabViewport(deps)).toMatchObject({
      ok: true, blob: fits, mime: 'image/png', width: 1920, height: 1200,
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
