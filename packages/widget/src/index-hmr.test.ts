// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Collector } from './collect';
import { HOST_ATTRIBUTE } from './mount';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import type { Widget } from './index';
import { reresolve, collectElement, selectorChain } from '@passback/collectors';

type Handler = (payload?: unknown) => void;
type FakeHot = {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};

const MARK_ID = '01J8ZQ4W3R5T6Y7U8I9O0P1A2S';

function fakeHot(): FakeHot {
  return { on: vi.fn(), off: vi.fn(), send: vi.fn() };
}

function fire(hot: FakeHot, event: string): void {
  for (const call of hot.on.mock.calls) {
    if (call[0] === event) (call[1] as Handler)();
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r(undefined)));
}

let widgets: Widget[] = [];

function fakeCollector(): Collector {
  return {
    relay: false,
    send: vi.fn(async () => ({ ok: true as const, id: MARK_ID, trimmed: false })),
    selectorOf: (el) => selectorChain(el)[0]?.value ?? el.tagName.toLowerCase(),
    targetOf: (el) => collectElement(el),
    reresolve,
    dispose: vi.fn(),
  };
}

function submitted(widgetHost: Element): Promise<void> {
  return new Promise((resolve) => {
    widgetHost.addEventListener('passback:submit', () => resolve(), { once: true });
  });
}

async function startWithHot(
  hot: FakeHot | undefined,
): Promise<{ widget: Widget; target: Element }> {
  (window as unknown as { __passback: unknown }).__passback = {
    autoStart: false,
    hot,
    collect: fakeCollector,
  };
  const { start } = await import('./index');
  const widget = start();
  widgets.push(widget);
  const widgetHost = document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`)!;
  const root = widgetHost.shadowRoot!;
  armWidget(root);
  const target = document.createElement('div');
  target.id = 'save';
  document.body.appendChild(target);
  target.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: 15,
      clientY: 27,
    }),
  );
  const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  textarea.value = 'broken';
  textarea.dispatchEvent(new Event('input'));
  const submission = submitted(widgetHost);
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  await submission;
  widget.acked(MARK_ID, false);
  return { widget, target };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  widgets = [];
  document.body.innerHTML = '';
  delete (window as unknown as { __passback?: unknown }).__passback;
  vi.restoreAllMocks();
});

describe('widget HMR re-attach', () => {
  it('reports an open mark whose element is gone after HMR as passback:orphaned', async () => {
    const hot = fakeHot();
    const { target } = await startWithHot(hot);
    fire(hot, 'vite:beforeUpdate');
    target.remove();
    fire(hot, 'vite:afterUpdate');
    await nextFrame();
    expect(hot.send).toHaveBeenCalledWith('passback:orphaned', { v: 1, markIds: [MARK_ID] });
  });

  it('sends nothing when the marked element is still there after HMR', async () => {
    const hot = fakeHot();
    await startWithHot(hot);
    fire(hot, 'vite:beforeUpdate');
    fire(hot, 'vite:afterUpdate');
    await nextFrame();
    expect(hot.send).not.toHaveBeenCalled();
  });

  it('registers no HMR listener without a hot', async () => {
    const hot = fakeHot();
    await startWithHot(undefined);
    expect(hot.on).not.toHaveBeenCalled();
  });

  it('removes its HMR listeners on stop()', async () => {
    const hot = fakeHot();
    const { widget } = await startWithHot(hot);
    expect(hot.on).toHaveBeenCalledWith('vite:beforeUpdate', expect.any(Function));
    widget.stop();
    expect(hot.off).toHaveBeenCalledWith('vite:beforeUpdate', expect.any(Function));
    expect(hot.off).toHaveBeenCalledWith('vite:afterUpdate', expect.any(Function));
  });
});
