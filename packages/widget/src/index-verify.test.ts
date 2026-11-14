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

function fire(hot: FakeHot, event: string, payload?: unknown): void {
  for (const call of hot.on.mock.calls) {
    if (call[0] === event) (call[1] as Handler)(payload);
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r(undefined)));
}

let widgets: Widget[] = [];

let verdicts: ('closed' | 'open')[] = [];

function fakeCollector(): Collector {
  return {
    measure: () => verdicts.shift() ?? 'closed',
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
  caps?: string[],
): Promise<{ widget: Widget; target: Element }> {
  (window as unknown as { __passback: unknown }).__passback = {
    autoStart: false,
    hot,
    caps,
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

const ITEMS = {
  v: 1,
  items: [
    {
      id: MARK_ID,
      status: 'proposed',
      annotations: [{ type: 'no-overlap', elements: ['self', 'parent'] }],
    },
  ],
};

beforeEach(() => {
  vi.resetModules();
  verdicts = [];
});

afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  widgets = [];
  document.body.innerHTML = '';
  delete (window as unknown as { __passback?: unknown }).__passback;
  vi.restoreAllMocks();
});

describe('widget verify after re-measure', () => {
  it('sends passback:verified when a snapshot shows a filed mark proposed and its annotations hold', async () => {
    const hot = fakeHot();
    await startWithHot(hot, ['verified']);
    fire(hot, 'passback:items', ITEMS);
    expect(hot.send).toHaveBeenCalledWith('passback:verified', { v: 1, markIds: [MARK_ID] });
  });

  it('measures again after vite:afterUpdate and sends once the earlier open result has become closed', async () => {
    const hot = fakeHot();
    await startWithHot(hot, ['verified']);
    verdicts = ['open'];
    fire(hot, 'passback:items', ITEMS);
    expect(hot.send).not.toHaveBeenCalled();
    fire(hot, 'vite:beforeUpdate');
    fire(hot, 'vite:afterUpdate');
    await nextFrame();
    expect(hot.send).toHaveBeenCalledWith('passback:verified', { v: 1, markIds: [MARK_ID] });
  });

  it('sends nothing when the integration does not list the verified capability', async () => {
    const hot = fakeHot();
    await startWithHot(hot, ['reopen']);
    fire(hot, 'passback:items', ITEMS);
    expect(hot.send).not.toHaveBeenCalled();
  });
});
