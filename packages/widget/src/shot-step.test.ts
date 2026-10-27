// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadShotOpen, type ShotSession } from './shot-loader';
import { createShotStep, drawingOf } from './shot-step';
import type { FlowCtx } from './overlay-draw';

vi.mock('./shot-loader', async (original) => ({
  ...(await original<typeof import('./shot-loader')>()),
  loadShotOpen: vi.fn(),
}));

const session = (): ShotSession => ({
  setActive: vi.fn(),
  count: () => 0,
  finish: vi.fn(),
  close: vi.fn(),
});
const flush = () => new Promise((resolve) => setTimeout(resolve));

function setup() {
  document.head.innerHTML =
    '<script data-passback-screenshots="true" data-passback-endpoint="/e" data-passback-shot="/shot.js"></script>';
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const onLoadFailed = vi.fn();
  const step = createShotStep({ doc: document, win: window, root, host, onLoadFailed });
  const preload = () => host.dispatchEvent(new Event('passback:preload'));
  return { step, preload, onLoadFailed, host };
}

beforeEach(() => vi.resetAllMocks());

describe('shot step', () => {
  it('R2 preloads a paused session once per epoch and a later press activates it', async () => {
    const made = session();
    const open = vi.fn(() => made);
    vi.mocked(loadShotOpen).mockResolvedValue(open);
    const { step, preload } = setup();
    preload();
    preload();
    await flush();
    expect(open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ active: false }));
    preload();
    step.toggle(true);
    expect(made.setActive).toHaveBeenCalledExactlyOnceWith(true);
    step.toggle(false);
    expect(made.setActive).toHaveBeenLastCalledWith(false);
    step.close();
    expect(made.close).toHaveBeenCalledOnce();
    preload();
    await flush();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('R2 a press while the preload is pending activates the session once it arrives', async () => {
    const made = session();
    const open = vi.fn(() => made);
    vi.mocked(loadShotOpen).mockResolvedValue(open);
    const { step, preload } = setup();
    preload();
    step.toggle(true);
    await flush();
    expect(made.setActive).toHaveBeenCalledWith(true);
  });

  it('R2 a press released before the load arrives opens nothing', async () => {
    const open = vi.fn(session);
    vi.mocked(loadShotOpen).mockResolvedValue(open);
    const { step, preload } = setup();
    step.toggle(true);
    step.toggle(false);
    await flush();
    expect(open).not.toHaveBeenCalled();
    preload();
    await flush();
    expect(open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ active: false }));
  });

  it('R2 a late load after close is dropped', async () => {
    const open = vi.fn(session);
    vi.mocked(loadShotOpen).mockResolvedValue(open);
    const { step, preload } = setup();
    preload();
    step.close();
    await flush();
    expect(open).not.toHaveBeenCalled();
  });

  it('R2 a failed preload is silent and a press still reports a failed load', async () => {
    vi.mocked(loadShotOpen).mockRejectedValue(new Error('offline'));
    const { step, preload, onLoadFailed } = setup();
    preload();
    preload();
    await flush();
    expect(onLoadFailed).not.toHaveBeenCalled();
    expect(loadShotOpen).toHaveBeenCalledTimes(1);
    step.toggle(true);
    await flush();
    expect(onLoadFailed).toHaveBeenCalledOnce();
  });

  it('local: a tag with an upload url enables drawing and opens the session with local and that url', async () => {
    const made = session();
    const open = vi.fn(() => made);
    vi.mocked(loadShotOpen).mockResolvedValue(open);
    document.head.innerHTML =
      '<script data-passback-screenshots="true" data-passback-shot-upload="/__passback/screenshot" data-passback-shot="/shot.js"></script>';
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const step = createShotStep({ doc: document, win: window, root, host, onLoadFailed: vi.fn() });
    expect(step.enabled).toBe(true);
    expect(drawingOf(step).drawing).toBeDefined();
    step.toggle(true);
    await flush();
    expect(open).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        uploadUrl: '/__passback/screenshot',
        local: true,
        active: true,
      }),
    );
  });

  async function loaded() {
    const made = session();
    const count = vi.fn(() => 0);
    made.count = count;
    vi.mocked(loadShotOpen).mockResolvedValue(() => made);
    const ctx = setup();
    ctx.preload();
    await flush();
    const element = document.createElement('div');
    const submit = (target: Element) =>
      ctx.host.dispatchEvent(
        new CustomEvent('passback:submit', {
          detail: { comment: 'c', selector: 's', offset: { x: 3, y: 4 }, element: target },
        }),
      );
    return { ...ctx, made, count, element, submit };
  }

  it('a send without a drawing still takes a picture of the pinned mark', async () => {
    const { step, made, count, element, submit } = await loaded();
    submit(element);
    await step.finish(element);
    expect(made.finish).toHaveBeenCalledExactlyOnceWith(
      element,
      expect.objectContaining({ element, offset: { x: 3, y: 4 } }),
    );
    expect(count).not.toHaveBeenCalled();
  });

  it('a send whose submit detail names another element passes no detail', async () => {
    const { step, made, element, submit } = await loaded();
    submit(document.createElement('span'));
    await step.finish(element);
    expect(made.finish).toHaveBeenCalledExactlyOnceWith(element, undefined);
  });
  it('binds drawing Send after lazy load and ignores cancelled loads', async () => {
    const made = session();
    made.bind = vi.fn();
    const open = vi.fn(() => made);
    vi.mocked(loadShotOpen).mockResolvedValue(open);
    const { step, preload } = setup();
    const ctx = {} as FlowCtx;
    drawingOf(step).drawing!.bind!(ctx);
    preload();
    await flush();
    expect(made.bind).toHaveBeenCalledExactlyOnceWith(ctx);
    const next = {} as FlowCtx;
    step.bind!(next);
    expect(made.bind).toHaveBeenLastCalledWith(next);
    step.close();
    preload();
    step.close();
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
    expect(made.bind).toHaveBeenCalledTimes(2);
    // A session without the hook still opens and closes.
    const plain = session();
    vi.mocked(loadShotOpen).mockResolvedValue(() => plain);
    step.bind!(ctx);
    preload();
    await flush();
    step.toggle(true);
    expect(plain.setActive).toHaveBeenCalledWith(true);
  });
});
