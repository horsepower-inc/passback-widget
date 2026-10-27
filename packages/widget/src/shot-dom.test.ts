// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { renderFrame } from './shot-dom';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));

const win = window as unknown as { __passback?: Record<string, unknown> };
const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;

beforeEach(() => {
  vi.mocked(toCanvas).mockReset();
  vi.mocked(toCanvas).mockResolvedValue(canvas);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete win.__passback;
  Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
});

describe('shot-dom', () => {
  it('renders the viewport and leaves the widget host out', async () => {
    const host = document.createElement('div');
    const frame = await renderFrame(window, host);
    expect(frame).toEqual({ source: canvas, width: 1280, height: 720 });
    expect(toCanvas).toHaveBeenCalledExactlyOnceWith(document.documentElement, {
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: 1,
      cacheBust: false,
      style: { transform: 'translate(0px, 0px)', transformOrigin: '0 0' },
      filter: expect.any(Function),
      imagePlaceholder: expect.stringMatching(/^data:image\/gif;base64,[A-Za-z0-9+/]+=*$/),
    });
    const { filter } = vi.mocked(toCanvas).mock.calls[0]![1]!;
    expect(filter!(host)).toBe(false);
    expect(filter!(document.body)).toBe(true);
    expect(filter!(document.createElement('div'))).toBe(true);
  });

  it('translates the page by the scroll position so the picture is the visible viewport', async () => {
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 30 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 450 });
    await renderFrame(window, document.createElement('div'));
    expect(vi.mocked(toCanvas).mock.calls[0]![1]!.style).toEqual({
      transform: 'translate(-30px, -450px)',
      transformOrigin: '0 0',
    });
  });

  it('uses the render function registered as __passback.shotRender when there is one', async () => {
    const own = { width: 10, height: 20 } as HTMLCanvasElement;
    const shotRender = vi.fn().mockResolvedValue(own);
    win.__passback = { shotRender };
    const host = document.createElement('div');
    expect(await renderFrame(window, host)).toEqual({ source: own, width: 10, height: 20 });
    expect(shotRender).toHaveBeenCalledExactlyOnceWith(
      document.documentElement,
      expect.objectContaining({ pixelRatio: 1, width: window.innerWidth }),
    );
    expect(toCanvas).not.toHaveBeenCalled();
    win.__passback = { shotRender: 'nope' };
    await renderFrame(window, host);
    expect(toCanvas).toHaveBeenCalledTimes(1);
  });

  it('rejects when the render takes longer than 8 seconds', async () => {
    vi.useFakeTimers();
    vi.mocked(toCanvas).mockReturnValue(new Promise(() => {}));
    let outcome: unknown = 'pending';
    const pending = renderFrame(window, document.createElement('div')).catch((e: unknown) => {
      outcome = e;
    });
    await vi.advanceTimersByTimeAsync(7999);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(outcome).toEqual(new Error('shot render timed out'));
    expect(vi.getTimerCount()).toBe(0);
    vi.mocked(toCanvas).mockResolvedValue(canvas);
    await renderFrame(window, document.createElement('div'));
    expect(vi.getTimerCount()).toBe(0);
    vi.mocked(toCanvas).mockRejectedValue(new Error('boom'));
    await expect(renderFrame(window, document.createElement('div'))).rejects.toThrow('boom');
    expect(vi.getTimerCount()).toBe(0);
  });
});
