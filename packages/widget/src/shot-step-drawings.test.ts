// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadShotOpen, type ShotSession } from './shot-loader';
import { createShotStep, drawingOf } from './shot-step';
import { drawOption, type FlowCtx } from './overlay-draw';

vi.mock('./shot-loader', async (original) => ({
  ...(await original<typeof import('./shot-loader')>()),
  loadShotOpen: vi.fn(),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve));
const reply = (body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const WARN =
  '[passback] Screenshots and drawings are off for this site: they need the Premium plan. https://passback.dev/pricing';

function setup(answer: () => Promise<Response>) {
  document.head.innerHTML =
    '<script data-passback-screenshots="true" data-passback-endpoint="https://relay.test/v1/ingest/demo" data-passback-shot="https://relay.test/shot.js"></script>';
  const win = Object.create(window) as Window & typeof globalThis;
  Object.defineProperty(win, 'fetch', { value: vi.fn(answer), configurable: true });
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const made: ShotSession = { setActive: vi.fn(), count: () => 0, finish: vi.fn(), close: vi.fn() };
  vi.mocked(loadShotOpen).mockResolvedValue(() => made);
  const step = createShotStep({ doc: document, win, root, host, onLoadFailed: vi.fn() });
  const pencil = (ctx: FlowCtx) => drawOption({ ...ctx, ...drawingOf(step) }, (f) => f).onDraw;
  return { step, host, made, pencil };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const bubbleElement = () => {
  const element = document.createElement('div');
  element.innerHTML = '<textarea></textarea>';
  element.querySelector('textarea')!.value = 'the comment';
  return element;
};

const ctxOf = (flow: string, setDrawing = vi.fn()) =>
  ({
    host: document.createElement('div'),
    state: {
      flow,
      phase: 'composing',
      marks: [],
      dot: null,
      bubble: { setDrawing, element: bubbleElement(), destroy: vi.fn() },
    },
  }) as unknown as FlowCtx;

describe('shot step drawings', () => {
  it('drawings false hides the pencil on the next mark', async () => {
    const { step, host, pencil } = setup(reply({ screenshots: false, drawings: false }));
    expect(pencil(ctxOf('armed'))).toBeTypeOf('function');
    await flush();
    expect(host.getAttribute('data-pb-drawing')).toBe('off');
    expect(pencil(ctxOf('armed'))).toBeUndefined();
    step.toggle(true);
    await flush();
    expect(loadShotOpen).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(WARN);
  });

  it('drawings false closes an open drawing and keeps the comment', async () => {
    let answer!: () => void;
    const held = new Promise<Response>((resolve) => {
      answer = () => resolve(new Response(JSON.stringify({ drawings: false }), { status: 200 }));
    });
    const { step, made, host } = setup(() => held);
    const setDrawing = vi.fn();
    const ctx = ctxOf('drawing', setDrawing);
    step.bind?.(ctx);
    step.toggle(true);
    await flush();
    answer();
    await flush();
    expect(made.close).toHaveBeenCalledOnce();
    expect(setDrawing).toHaveBeenCalledExactlyOnceWith(false);
    expect(ctx.state.flow).toBe('composing');
    expect(ctx.state.bubble).not.toBeNull();
    expect(ctx.state.bubble?.element.querySelector('textarea')?.value).toBe('the comment');
    expect(host.getAttribute('data-pb-drawing')).toBe('off');
  });

  it('screenshots false with drawings allowed keeps the pencil', async () => {
    const { host, pencil } = setup(reply({ screenshots: false, drawings: true }));
    await flush();
    expect(host.getAttribute('data-pb-pictures')).toBe('off');
    expect(host.hasAttribute('data-pb-drawing')).toBe(false);
    expect(pencil(ctxOf('armed'))).toBeTypeOf('function');
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('shapes only'));
  });

  it('an answer without drawings keeps the pencil', async () => {
    const { host, pencil } = setup(reply({ screenshots: true }));
    await flush();
    expect(host.hasAttribute('data-pb-drawing')).toBe(false);
    expect(pencil(ctxOf('armed'))).toBeTypeOf('function');
    expect(console.warn).not.toHaveBeenCalled();
  });
});
