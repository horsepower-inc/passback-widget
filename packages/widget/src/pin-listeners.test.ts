// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PinEvent } from './pin';
import { pointOffset } from './pin';
import { listenForPin } from './pin-listeners';

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

function buildDom() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const button = document.createElement('button');
  shadow.appendChild(button);
  const outside = document.createElement('div');
  document.body.appendChild(outside);
  return { host, button, outside };
}

let removers: Array<() => void> = [];

afterEach(() => {
  removers.forEach((remove) => remove());
  removers = [];
  document.body.innerHTML = '';
});

function attach(host: Element) {
  const events: PinEvent[] = [];
  const remove = listenForPin({ doc: document, host, dispatch: (event) => events.push(event) });
  removers.push(remove);
  return { events, remove };
}

describe('listenForPin', () => {
  it('a pointermove dispatches hover with the element under the pointer', () => {
    const { host, outside } = buildDom();
    const { events } = attach(host);

    outside.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));

    expect(events).toEqual([{ type: 'hover', target: outside }]);
  });

  it('a pointermove inside the widget host dispatches hover with null', () => {
    const { host, button } = buildDom();
    const { events } = attach(host);

    button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));

    expect(events).toEqual([{ type: 'hover', target: null }]);
  });

  it('a click dispatches pin with the offset and never reaches the page listener', () => {
    const { host, outside } = buildDom();
    stubRect(outside, 10, 20);
    const { events } = attach(host);
    const pageListener = vi.fn();
    outside.addEventListener('click', pageListener);

    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: 15,
      clientY: 27,
    });
    outside.dispatchEvent(event);

    expect(pageListener).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(events).toEqual([
      { type: 'pin', target: outside, offset: pointOffset(outside, 15, 27) },
    ]);
  });

  it('a pin click never reaches a later document capture listener', () => {
    const { host, outside } = buildDom();
    stubRect(outside, 10, 20);
    attach(host);
    const laterCaptureListener = vi.fn();
    document.addEventListener('click', laterCaptureListener, true);

    outside.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: 15,
        clientY: 27,
      }),
    );

    document.removeEventListener('click', laterCaptureListener, true);
    expect(laterCaptureListener).not.toHaveBeenCalled();
  });

  it('a click inside the widget host is left alone', () => {
    const { host, button } = buildDom();
    const { events } = attach(host);
    const buttonListener = vi.fn();
    button.addEventListener('click', buttonListener);

    button.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
    );

    expect(buttonListener).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
  });

  it('pointerdown and mousedown outside the widget never reach the page listener', () => {
    const { host, outside } = buildDom();
    attach(host);
    const pointerdownListener = vi.fn();
    const mousedownListener = vi.fn();
    outside.addEventListener('pointerdown', pointerdownListener);
    outside.addEventListener('mousedown', mousedownListener);

    outside.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true }),
    );
    outside.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true }),
    );

    expect(pointerdownListener).not.toHaveBeenCalled();
    expect(mousedownListener).not.toHaveBeenCalled();
  });

  it('Escape dispatches cancel', () => {
    const { host } = buildDom();
    const { events } = attach(host);

    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    document.dispatchEvent(event);

    expect(events).toEqual([{ type: 'cancel' }]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('another key dispatches nothing', () => {
    const { host } = buildDom();
    const { events } = attach(host);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', cancelable: true, bubbles: true }),
    );

    expect(events).toEqual([]);
  });

  it('the remover detaches every listener', () => {
    const { host, outside } = buildDom();
    const { events, remove } = attach(host);

    remove();
    remove();
    outside.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
    outside.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: 1,
        clientY: 1,
      }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true }),
    );

    expect(events).toEqual([]);
  });

  it('a passback:shape event pins nothing', () => {
    const { host, outside } = buildDom();
    stubRect(outside, 10, 20);
    const { events } = attach(host);
    document.elementsFromPoint = () => [host, outside];
    host.dispatchEvent(new CustomEvent('passback:shape', { detail: { x: 15, y: 30 } }));
    expect(events).toEqual([]);
  });
});
