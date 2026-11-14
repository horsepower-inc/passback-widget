// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collect } from './collect';
import { HOST_ATTRIBUTE } from './mount';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import type { SubmitDetail } from './overlay';
import type { Widget } from './index';

type WindowWithPassback = Window & { __passback?: { autoStart?: boolean; collect?: unknown } };

function windowWithPassback(): WindowWithPassback {
  return window as WindowWithPassback;
}

function disableAutoStart(): void {
  windowWithPassback().__passback = { autoStart: false };
}

function host(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`);
}

function stubRect(el: Element, left: number, top: number): void {
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: left,
      y: top,
      toJSON() {},
    }) as DOMRect;
}

function pinTarget(left: number, top: number, clientX: number, clientY: number): Element {
  const target = document.createElement('div');
  target.id = 'save';
  document.body.appendChild(target);
  stubRect(target, left, top);
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX, clientY }),
  );
  return target;
}

function armAndCompose(root: ShadowRoot): { textarea: HTMLTextAreaElement } {
  armWidget(root);
  pinTarget(10, 20, 15, 27);
  const textarea = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  return { textarea };
}

function makeButtonCreationThrow(): () => void {
  const original = document.createElement.bind(document);
  const spy = vi.spyOn(document, 'createElement').mockImplementation(((
    tagName: string,
    options?: ElementCreationOptions,
  ) => {
    if (tagName === 'button') throw new Error('overlay boom');
    return original(tagName, options);
  }) as typeof document.createElement);
  return () => spy.mockRestore();
}

async function startWidget(): Promise<{
  start: typeof import('./index').start;
  widget: Widget;
  root: ShadowRoot;
}> {
  disableAutoStart();
  const { start } = await import('./index');
  const widget = start();
  widgets.push(widget);
  const root = host()!.shadowRoot!;
  return { start, widget, root };
}

let widgets: Widget[] = [];

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  widgets = [];
  document.body.innerHTML = '';
  delete windowWithPassback().__passback;
  vi.restoreAllMocks();
  vi.doUnmock('./mount');
  vi.doUnmock('./overlay');
});

describe('widget entry', () => {
  it('mounts one host with the launcher and styles on start', async () => {
    const { root } = await startWidget();

    expect(document.querySelectorAll(`[${HOST_ATTRIBUTE}]`).length).toBe(1);
    expect(root.querySelector(`.${CLASS.launcher}`)).not.toBeNull();
    expect(root.querySelector('style[data-pb-styles]')).not.toBeNull();
  });

  it('starts once on import', async () => {
    await import('./index');

    expect(document.querySelectorAll(`[${HOST_ATTRIBUTE}]`).length).toBe(1);
  });

  it('does not start when autoStart is false', async () => {
    disableAutoStart();
    await import('./index');

    expect(host()).toBeNull();
  });

  it('dispatches passback:submit with the comment, selector and offset', async () => {
    const { root } = await startWidget();
    windowWithPassback().__passback!.collect = collect;
    const { textarea } = armAndCompose(root);
    textarea.value = 'hello there';
    textarea.dispatchEvent(new Event('input'));

    const detail = await new Promise<SubmitDetail>((resolve) => {
      host()!.addEventListener(
        'passback:submit',
        (event) => resolve((event as CustomEvent<SubmitDetail>).detail),
        {
          once: true,
        },
      );
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });

    expect(detail.comment).toBe('hello there');
    expect(detail.selector).toBe('#save');
    expect(detail.offset).toEqual({ x: 5, y: 7 });
  });

  it('the collector the core uses exposes selectorOf, targetOf and reresolve', () => {
    const collector = collect({ win: window, onStatus: () => undefined });
    const el = document.createElement('div');
    el.id = 'save';
    document.body.appendChild(el);

    expect(typeof collector.selectorOf).toBe('function');
    expect(typeof collector.targetOf).toBe('function');
    expect(typeof collector.reresolve).toBe('function');
    expect(collector.selectorOf(el)).toBe('#save');
    expect(collector.reresolve(document, collector.targetOf(el))?.element).toBe(el);
    collector.dispose();
  });

  it('unmounts and warns once when the overlay throws', async () => {
    disableAutoStart();
    const { start } = await import('./index');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restoreCreateElement = makeButtonCreationThrow();

    widgets.push(start());
    restoreCreateElement();

    expect(host()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[passback\]/);
  });

  it('keeps a throwing start away from window.onerror', async () => {
    disableAutoStart();
    const { start } = await import('./index');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restoreCreateElement = makeButtonCreationThrow();
    const onError = vi.fn();
    window.addEventListener('error', onError);

    expect(() => widgets.push(start())).not.toThrow();
    restoreCreateElement();
    window.removeEventListener('error', onError);

    expect(onError).not.toHaveBeenCalled();
  });

  it('unmounts the host on stop', async () => {
    const { widget } = await startWidget();

    expect(host()).not.toBeNull();
    widget.stop();

    expect(host()).toBeNull();
  });

  it('destroys the overlay before unmounting when the boundary trips', async () => {
    disableAutoStart();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const order: string[] = [];

    vi.doMock('./mount', async () => {
      const actual = await vi.importActual<typeof import('./mount')>('./mount');
      return {
        ...actual,
        mount: (doc?: Document) => {
          const mounted = actual.mount(doc);
          return {
            ...mounted,
            unmount: () => {
              order.push('unmount');
              mounted.unmount();
            },
          };
        },
      };
    });

    vi.doMock('./overlay', async () => {
      const actual = await vi.importActual<typeof import('./overlay')>('./overlay');
      return {
        ...actual,
        createOverlay: (opts: Parameters<typeof actual.createOverlay>[0]) => {
          const overlay = actual.createOverlay(opts);
          return {
            ...overlay,
            destroy: () => {
              order.push('destroy');
              overlay.destroy();
            },
          };
        },
      };
    });

    const { start } = await import('./index');
    widgets.push(start());
    const root = host()!.shadowRoot!;

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => {
      if (tagName === 'div') throw new Error('outline boom');
      return originalCreateElement(tagName, options);
    }) as typeof document.createElement);

    armWidget(root);

    expect(order).toEqual(['destroy', 'unmount']);
  });
});
