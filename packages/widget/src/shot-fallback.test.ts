// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shotMaskRects } from '@passback/collectors/shot-mask';
import { grabViewport, type GrabDeps } from './shot-grab';

vi.mock('@passback/collectors/shot-mask', () => ({ shotMaskRects: vi.fn() }));

const FAILED = { ok: false, reason: 'capture failed' };
const win = window as unknown as { __passback?: Record<string, unknown> };
const video = { videoWidth: 1280, videoHeight: 720 };
const TOO_LARGE = { ok: false, reason: 'image too large' };
const boom = (): never => {
  throw new Error('boom');
};
const define = (o: object, k: string, value: unknown) =>
  Object.defineProperty(o, k, { configurable: true, value });
const flush = () => vi.advanceTimersByTimeAsync(50);

function track(surface?: string, stop: () => void = vi.fn()) {
  const getSettings = () => ({ displaySurface: surface });
  return Object.assign(new EventTarget(), { stop, readyState: 'live', getSettings });
}
const streamOf = (...tracks: ReturnType<typeof track>[]) =>
  Object.assign(new window.MediaStream(), {
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
  });

type S = ReturnType<typeof setup>;
function setup(active = true) {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const bubble = document.createElement('div');
  bubble.className = 'pb-bubble';
  bubble.setAttribute('data-state', 'sending');
  bubble.hidden = true;
  root.append(bubble);
  document.body.replaceChildren(host);
  host.style.visibility = 'visible';
  define(navigator, 'userActivation', { isActive: active });
  const getDisplayMedia = vi.fn();
  define(navigator, 'mediaDevices', { getDisplayMedia });
  const ctx = Object.fromEntries(
    ['drawImage', 'fillRect', 'stroke', 'strokeRect', 'beginPath', 'arc', 'fill', 'fillText'].map(
      (name) => [name, vi.fn()],
    ),
  ) as Record<string, ReturnType<typeof vi.fn>>;
  const toBlob = vi.fn((cb: BlobCallback) => cb(new Blob(['ok'], { type: 'image/webp' })));
  const makeCanvas = vi.fn(
    (width: number, height: number) =>
      ({ width, height, getContext: () => ctx, toBlob }) as unknown as HTMLCanvasElement,
  );
  const render = vi.fn().mockRejectedValue(new Error('render failed'));
  const overBudget = vi.fn().mockReturnValue(false);
  const deps: GrabDeps = { win: window, host, shapes: [], render, makeCanvas, overBudget };
  const button = () => root.querySelector<HTMLButtonElement>('button[data-role="capture-screen"]');
  return {
    deps,
    host,
    bubble,
    getDisplayMedia,
    render,
    overBudget,
    ctx,
    toBlob,
    makeCanvas,
    button,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(shotMaskRects).mockReset().mockReturnValue([]);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => setTimeout(cb, 0) as never);
  vi.spyOn(HTMLVideoElement.prototype, 'play').mockResolvedValue(undefined);
  for (const k of Object.keys(video))
    Object.defineProperty(HTMLVideoElement.prototype, k, {
      configurable: true,
      get: () => video[k as 'videoWidth'],
    });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete win.__passback;
  video.videoWidth = 1280;
});

describe('shot-fallback', () => {
  it('captures synchronously when the DOM budget is exceeded', async () => {
    const { deps, getDisplayMedia, render, overBudget, bubble, button } = setup();
    overBudget.mockReturnValue(true);
    getDisplayMedia.mockResolvedValue(streamOf(track('browser')));
    const result = grabViewport(deps);
    const ask = { video: true, preferCurrentTab: true };
    expect(getDisplayMedia).toHaveBeenCalledExactlyOnceWith(ask);
    expect([render.mock.calls.length, button()]).toEqual([0, null]);
    expect(bubble.textContent).toBe('Choose this tab in the picker to attach a picture.');
    await flush();
    expect(await result).toMatchObject({ ok: true, mime: 'image/webp' });
    expect([bubble.textContent, bubble.hidden]).toEqual(['', true]);
  });

  it('offers one capture click when user activation is unavailable', async () => {
    const { deps, getDisplayMedia, render, overBudget, bubble, button } = setup(false);
    overBudget.mockReturnValue(true);
    getDisplayMedia.mockResolvedValue(streamOf(track()));
    const result = grabViewport(deps);
    await flush();
    expect([render, getDisplayMedia].map((fn) => fn.mock.calls.length)).toEqual([0, 0]);
    expect(bubble.hidden).toBe(false);
    expect(bubble.textContent).toContain(
      'Page capture failed. Capture this tab to attach a picture.',
    );
    button()!.click();
    button()!.click();
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    await flush();
    expect(await result).toMatchObject({ ok: true });
    expect([button(), bubble.hidden]).toEqual([null, true]);
  });

  it('waits for a capture click after render rejection or timeout', async () => {
    const { deps, getDisplayMedia, render, bubble, button } = setup();
    const settled = vi.fn();
    getDisplayMedia.mockResolvedValue(streamOf(track('browser')));
    for (const timeout of [false, true]) {
      render.mockReset();
      getDisplayMedia.mockClear();
      let late: () => void = () => undefined;
      if (timeout) {
        win.__passback = {
          shotRender: () =>
            new Promise((resolve) => (late = () => resolve({ width: 1, height: 1 }))),
        };
        delete deps.render;
      } else render.mockRejectedValue(new Error('render failed'));
      const result = grabViewport(deps).then(settled);
      await vi.advanceTimersByTimeAsync(7999);
      expect(button() === null).toBe(timeout);
      await vi.advanceTimersByTimeAsync(1);
      expect(button()).not.toBeNull();
      await vi.advanceTimersByTimeAsync(60000);
      late();
      expect(getDisplayMedia).not.toHaveBeenCalled();
      expect(settled).not.toHaveBeenCalled();
      button()!.click();
      expect(getDisplayMedia).toHaveBeenCalledTimes(1);
      await flush();
      await result;
      expect(settled).toHaveBeenCalledTimes(1);
      settled.mockClear();
      bubble.hidden = true;
    }
  });

  it('paints browser frames through the existing screenshot pipeline', async () => {
    const { deps, getDisplayMedia, overBudget, ctx, toBlob, makeCanvas } = setup();
    overBudget.mockReturnValue(true);
    deps.local = true;
    toBlob.mockImplementation((cb) => cb(new Blob(['ok'], { type: 'image/png' })));
    deps.shapes = [{ tool: 'line', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } }];
    deps.makePath = vi.fn(() => ({}) as Path2D);
    vi.mocked(shotMaskRects).mockReturnValue([{ x: 0, y: 0, width: 10, height: 20 }]);
    getDisplayMedia.mockResolvedValue(streamOf(track('browser')));
    const result = grabViewport(deps);
    await flush();
    expect(await result).toMatchObject({ ok: true, mime: 'image/png', width: 1280, height: 720 });
    expect(makeCanvas).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(deps.makePath).toHaveBeenCalledTimes(1);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', expect.any(Number));
  });

  it.each([
    ['denial', 'reject', new DOMException('no', 'NotAllowedError')],
    ['cancellation', 'reject', new DOMException('no', 'AbortError')],
    ['non-browser surface', 'stream', streamOf(track('monitor'))],
    ['zero-sized frame', 'size', streamOf(track('browser'))],
    ['playback failure', 'play', streamOf(track('browser'))],
  ])(
    'settles browser capture failures without reopening the picker: %s',
    async (_n, kind, value) => {
      const { deps, getDisplayMedia, overBudget } = setup();
      overBudget.mockReturnValue(true);
      if (kind === 'size') video.videoWidth = 0;
      if (kind === 'play')
        vi.spyOn(HTMLVideoElement.prototype, 'play').mockRejectedValue(new Error('x'));
      if (kind === 'reject') getDisplayMedia.mockRejectedValue(value);
      else getDisplayMedia.mockResolvedValue(value);
      const result = grabViewport(deps);
      await flush();
      expect(await result).toEqual(FAILED);
      expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    },
  );

  it('settles a missing capture API and a missing sending mark as unsuccessful', async () => {
    for (const active of [true, false]) {
      const s = setup(active);
      s.overBudget.mockReturnValue(active);
      define(navigator, 'mediaDevices', undefined);
      expect(await grabViewport(s.deps)).toEqual(FAILED);
      expect(s.button()).toBeNull();
      const t = setup(active);
      t.overBudget.mockReturnValue(true);
      t.host.shadowRoot!.replaceChildren();
      expect(await grabViewport(t.deps)).toEqual(FAILED);
    }
  });

  it.each([
    ['success', streamOf(track('browser'), track('browser'))],
    ['monitor', streamOf(track('monitor'), track('monitor'))],
    ['cleanup failure', streamOf(track('browser', boom), track('browser'))],
    ['track ends before the first frame', streamOf(track('browser'), track('browser'))],
    ['track already ended', streamOf(Object.assign(track('browser'), { readyState: 'ended' }))],
  ])(
    'restores visibility and stops every acquired track on every exit: %s',
    async (name, stream) => {
      const { deps, host, getDisplayMedia, overBudget } = setup();
      overBudget.mockReturnValue(true);
      getDisplayMedia.mockImplementation(
        async () => (expect(host.style.visibility).toBe('visible'), stream),
      );
      vi.spyOn(HTMLVideoElement.prototype, 'play').mockImplementation(async () => {
        expect(host.style.visibility).toBe('hidden');
        if (!name.includes('ends')) return;
        stream.getTracks()[1]!.dispatchEvent(new Event('ended'));
        await new Promise(() => undefined);
      });
      const stops = stream.getTracks().map((t) => vi.spyOn(t, 'stop'));
      const result = grabViewport(deps);
      await flush();
      expect(((await result) as { ok: boolean }).ok).toBe(name === 'success');
      expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
      expect(host.style.visibility).toBe('visible');
    },
  );

  it.each([
    ['mark', false, 'picker', 1],
    ['host', false, 'picker', 1],
    ['mark', true, 'picker', 1],
    ['host', true, 'play', 1],
    ['button', false, 'detached', 0],
  ] as const)(
    'disposes recovery controls and stops streams arriving after disposal: %s %s %s',
    async (how, active, stage, asked) => {
      const s = setup(active);
      s.overBudget.mockReturnValue(active);
      const stop = vi.fn();
      let arrive: () => void = () => undefined;
      const stream = streamOf(track('browser', stop));
      s.getDisplayMedia.mockReturnValue(new Promise((resolve) => (arrive = () => resolve(stream))));
      if (stage === 'play') {
        vi.spyOn(HTMLVideoElement.prototype, 'play').mockReturnValue(new Promise(() => undefined));
        arrive();
      }
      const result = grabViewport(s.deps);
      await flush();
      const click = s.button();
      if (how === 'button') click!.remove();
      click?.click();
      await flush();
      if (how === 'mark') s.bubble.remove();
      if (how === 'host') s.host.remove();
      await flush();
      expect(await result).toEqual(FAILED);
      expect(stop).toHaveBeenCalledTimes(stage === 'play' ? 1 : 0);
      arrive();
      await flush();
      expect(stop).toHaveBeenCalledTimes(asked);
      click?.click();
      expect(s.getDisplayMedia).toHaveBeenCalledTimes(asked);
      expect([s.button(), s.host.style.visibility]).toEqual([null, 'visible']);
    },
  );

  it.each([
    [
      'painting',
      (s: S) => s.makeCanvas.mockReturnValue({ getContext: () => null } as never),
      FAILED,
    ],
    ['encoding', (s: S) => s.toBlob.mockImplementation((cb) => cb(null)), TOO_LARGE],
    ['masking', () => vi.mocked(shotMaskRects).mockImplementation(boom), FAILED],
  ])(
    'does not invoke fallback for painting encoding or upload failures: %s',
    async (_n, arrange, expected) => {
      const s = setup();
      s.render.mockResolvedValue({ source: document.body, width: 100, height: 80 });
      arrange(s);
      expect(await grabViewport(s.deps)).toEqual(expected);
      expect(s.getDisplayMedia).not.toHaveBeenCalled();
      expect(s.button()).toBeNull();
    },
  );
});
