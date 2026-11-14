// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOST_ATTRIBUTE } from './mount';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import type { Widget } from './index';

type WindowWithPassback = Window & { __passback?: { autoStart?: boolean } };
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
function sendComment(textarea: HTMLTextAreaElement, comment: string): void {
  textarea.value = comment;
  textarea.dispatchEvent(new Event('input'));
  textarea.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
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
});

describe('widget entry: lifecycle and acks', () => {
  it('ignores a stale stop from a widget that is no longer active', async () => {
    disableAutoStart();
    const { start } = await import('./index');
    const a = start();
    a.stop();
    const b = start();
    widgets.push(b);

    a.stop();
    const c = start();

    expect(c).toBe(b);
    expect(document.querySelectorAll(`[${HOST_ATTRIBUTE}]`).length).toBe(1);
  });
  it('returns the active instance when start is called twice', async () => {
    const { start, widget: first } = await startWidget();

    const second = start();

    expect(second).toBe(first);
    expect(document.querySelectorAll(`[${HOST_ATTRIBUTE}]`).length).toBe(1);
  });
  it('does not mount at DOMContentLoaded after stop() was called while the document was loading', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const { start } = await import('./index');
    const widget = start();
    expect(host()).not.toBeNull();

    widget.stop();
    expect(host()).toBeNull();

    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(host()).toBeNull();
  });
  it('acked() on the widget puts the open bubble in its acked state', async () => {
    const { widget, root } = await startWidget();
    const { textarea } = armAndCompose(root);
    sendComment(textarea, 'hello there');
    widget.acked('m_1', true);

    const notes = Array.from(root.querySelectorAll(`.${CLASS.note}`)).map((el) => el.textContent);
    expect(root.querySelector(`.${CLASS.bubble}`)!.getAttribute('data-mark-id')).toBe('m_1');
    expect(notes).toContain('Trimmed to fit the size limit.');
    expect(root.querySelector(`.${CLASS.dot}`)!.getAttribute('data-state')).toBe('queued');
    expect(root.querySelector(`.${CLASS.launcher}`)!.hasAttribute('hidden')).toBe(false);
  });
  it('failed() on the widget shows the bubble error and leaves the sending phase', async () => {
    const { widget, root } = await startWidget();
    const { textarea } = armAndCompose(root);
    sendComment(textarea, 'hello there');
    widget.failed('network down');

    expect(root.querySelector(`.${CLASS.bubble}`)!.textContent).toContain('network down');
    expect(root.querySelector(`.${CLASS.send}`)?.textContent).toBe('Retry');
    expect(root.querySelector(`.${CLASS.bubble}`)!.getAttribute('data-state')).toBe('sending');
    expect(root.querySelector(`.${CLASS.launcher}`)!.hasAttribute('hidden')).toBe(true);
  });
  it('acked() and failed() do nothing after stop()', async () => {
    const { widget, root } = await startWidget();
    const { textarea } = armAndCompose(root);
    sendComment(textarea, 'hello there');
    widget.stop();
    expect(host()).toBeNull();

    expect(() => widget.acked('m_1', false)).not.toThrow();
    expect(() => widget.failed('nope')).not.toThrow();
    expect(host()).toBeNull();
  });
});
