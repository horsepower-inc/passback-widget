// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolveTarget, Resolved } from '@passback/collectors';
import type { Collector, CollectOptions } from './collect';
import type { SendResult } from './send';
import { HOST_ATTRIBUTE } from './mount';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import type { Widget } from './index';

type Passback = { autoStart: boolean; collect?: unknown; hot?: unknown };

function setPassback(value: Passback): void {
  (window as unknown as { __passback?: Passback }).__passback = value;
}

function stubRect(el: Element): void {
  el.getBoundingClientRect = () =>
    ({
      left: 10,
      top: 20,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 10,
      y: 20,
      toJSON() {},
    }) as DOMRect;
}

function openMark(root: ShadowRoot, comment: string): Element {
  armWidget(root);
  const target = document.createElement('div');
  target.id = 'save';
  document.body.appendChild(target);
  stubRect(target);
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
  textarea.value = comment;
  textarea.dispatchEvent(new Event('input'));
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  return target;
}

type Fake = {
  relay: boolean;
  send: ReturnType<typeof vi.fn<(el: Element, comment: string) => Promise<SendResult>>>;
  selectorOf: ReturnType<typeof vi.fn<(el: Element) => string>>;
  targetOf: ReturnType<typeof vi.fn<(el: Element) => ResolveTarget>>;
  reresolve: ReturnType<typeof vi.fn<() => Resolved | null>>;
  dispose: ReturnType<typeof vi.fn<() => void>>;
};

const FAKE_TARGET = { selectors: [], tag: 'div', text: '' } as ResolveTarget;

function fakeCollector(result: SendResult = { ok: true, id: 'abc', trimmed: false }): Fake {
  return {
    relay: false,
    send: vi.fn(async () => result),
    selectorOf: vi.fn(() => '#save'),
    targetOf: vi.fn(() => FAKE_TARGET),
    reresolve: vi.fn(() => null),
    dispose: vi.fn(),
  };
}

let widgets: Widget[] = [];

async function startWidget(): Promise<ShadowRoot> {
  const { start } = await import('./index');
  const widget = start();
  widgets.push(widget);
  return document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`)!.shadowRoot!;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function bubbleText(root: ShadowRoot): string {
  return root.querySelector(`.${CLASS.bubble}`)!.textContent ?? '';
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  widgets = [];
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete (window as unknown as { __passback?: Passback }).__passback;
  vi.restoreAllMocks();
});

describe('widget send wiring', () => {
  it('loads the collector on arm and Send hands it the pinned element and the comment', async () => {
    const collector = fakeCollector();
    const factory = vi.fn<(opts: CollectOptions) => Collector>(() => collector);
    setPassback({ autoStart: false, collect: factory });
    const root = await startWidget();
    const target = openMark(root, 'make it blue');
    await settle();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(collector.send).toHaveBeenCalledWith(target, 'make it blue');
  });

  it('shows the acked id and the queued dot when the collector resolves ok', async () => {
    setPassback({
      autoStart: false,
      collect: () => fakeCollector({ ok: true, id: 'mark-1', trimmed: false }),
    });
    const root = await startWidget();
    openMark(root, 'hi');
    await settle();
    expect(root.querySelector(`.${CLASS.bubble}`)!.getAttribute('data-mark-id')).toBe('mark-1');
    expect(root.querySelector(`.${CLASS.dot}`)!.getAttribute('data-state')).toBe('queued');
  });

  it('shows the error with Retry when the collector resolves not ok, and Retry sends again', async () => {
    const collector = fakeCollector({ ok: false, reason: 'rejected', message: 'nope' });
    setPassback({ autoStart: false, collect: () => collector });
    const root = await startWidget();
    openMark(root, 'hi');
    await settle();
    expect(bubbleText(root)).toContain('Not sent: nope');
    const retry = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Retry',
    )!;
    collector.send.mockResolvedValueOnce({ ok: true, id: 'mark-2', trimmed: false });
    retry.click();
    await settle();
    expect(collector.send).toHaveBeenCalledTimes(2);
    expect(root.querySelector(`.${CLASS.bubble}`)!.getAttribute('data-mark-id')).toBe('mark-2');
  });

  it('says Passback could not finish loading when the collector factory throws', async () => {
    setPassback({
      autoStart: false,
      collect: () => {
        throw new Error('boom');
      },
    });
    const root = await startWidget();
    openMark(root, 'hi');
    await settle();
    expect(bubbleText(root)).toContain('Not sent: Passback could not finish loading.');
    expect(bubbleText(root)).not.toContain('boom');
  });

  it('says Passback could not finish loading when the chunk cannot be loaded', async () => {
    const collector = fakeCollector();
    setPassback({ autoStart: false });
    const root = await startWidget();
    const events: unknown[] = [];
    document
      .querySelector(`[${HOST_ATTRIBUTE}]`)!
      .addEventListener('passback:submit', (e) => events.push((e as CustomEvent).detail));
    const target = openMark(root, 'hi');
    await settle();
    expect(bubbleText(root)).toContain('Not sent: Passback could not finish loading.');
    expect(bubbleText(root)).not.toContain('passback:');
    const retry = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Retry',
    );
    expect(retry).toBeDefined();
    expect(events).toEqual([]);
    expect(collector.send).not.toHaveBeenCalled();
    setPassback({ autoStart: false, collect: () => collector });
    retry!.click();
    await settle();
    expect(events).toHaveLength(1);
    expect(collector.send).toHaveBeenCalledWith(target, 'hi');
  });

  it('computes selector and target only after the collector chunk has loaded', async () => {
    const collector = fakeCollector();
    const script = document.createElement('script');
    script.setAttribute('data-passback-chunk', '/chunk.js');
    document.head.appendChild(script);
    setPassback({ autoStart: false });
    const root = await startWidget();
    const host = document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`)!;
    const events: unknown[] = [];
    host.addEventListener('passback:submit', (e) => events.push((e as CustomEvent).detail));
    const loading: HTMLScriptElement[] = [];
    vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
      loading.push(node as HTMLScriptElement);
      return node;
    }) as typeof document.head.appendChild);
    const chunks = () => loading;
    expect(chunks().length).toBe(0);
    const target = openMark(root, 'late');
    await settle();
    expect(chunks().length).toBe(1);
    expect(collector.selectorOf).not.toHaveBeenCalled();
    expect(collector.targetOf).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(collector.send).not.toHaveBeenCalled();
    setPassback({ autoStart: false, collect: () => collector });
    chunks()[0]!.dispatchEvent(new Event('load'));
    await settle();
    expect(collector.selectorOf).toHaveBeenCalledWith(target);
    expect(collector.targetOf).toHaveBeenCalledWith(target);
    expect(events).toEqual([expect.objectContaining({ comment: 'late', selector: '#save' })]);
    expect(collector.send).toHaveBeenCalledWith(target, 'late');
  });

  it('relays a status event to the dot of the acked mark', async () => {
    let onStatus: CollectOptions['onStatus'] = () => undefined;
    setPassback({
      autoStart: false,
      collect: (opts: CollectOptions) => {
        onStatus = opts.onStatus;
        return fakeCollector({ ok: true, id: 'mark-3', trimmed: false });
      },
    });
    const root = await startWidget();
    openMark(root, 'hi');
    await settle();
    onStatus({ v: 1, markId: 'mark-3', state: 'running' } as Parameters<
      CollectOptions['onStatus']
    >[0]);
    expect(root.querySelector(`.${CLASS.dot}`)!.getAttribute('data-state')).toBe('running');
  });

  it('passes window.__passback.hot and the script endpoint to the collector', async () => {
    const hot = { send: vi.fn(), on: vi.fn(), off: vi.fn() };
    const factory = vi.fn<(opts: CollectOptions) => Collector>(() => fakeCollector());
    const script = document.createElement('script');
    script.setAttribute('data-passback-endpoint', '/__passback/mark');
    document.head.appendChild(script);
    setPassback({ autoStart: false, collect: factory, hot });
    const root = await startWidget();
    armWidget(root);
    await settle();
    const opts = factory.mock.calls[0]![0];
    expect(opts.hot).toBe(hot);
    expect(opts.endpoint).toBe('/__passback/mark');
  });

  it('stop() disposes the collector', async () => {
    const collector = fakeCollector();
    setPassback({ autoStart: false, collect: () => collector });
    const root = await startWidget();
    armWidget(root);
    await settle();
    widgets[0]!.stop();
    expect(collector.dispose).toHaveBeenCalledTimes(1);
  });
});
