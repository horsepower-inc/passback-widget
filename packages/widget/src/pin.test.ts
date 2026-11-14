// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { IDLE, pinReducer, pinTarget, pointOffset } from './pin';
import type { PinState } from './pin';

describe('pinReducer', () => {
  it('arm enters armed with nothing hovered', () => {
    const next = pinReducer(IDLE, { type: 'arm' });
    expect(next).toEqual({ phase: 'armed', hovered: null });
  });

  it('arm while armed returns the same state', () => {
    const armed: PinState = { phase: 'armed', hovered: null };
    const next = pinReducer(armed, { type: 'arm' });
    expect(next).toBe(armed);
  });

  it('hover while armed records the hovered element', () => {
    const target = document.createElement('div');
    const armed: PinState = { phase: 'armed', hovered: null };
    const next = pinReducer(armed, { type: 'hover', target });
    expect(next).toEqual({ phase: 'armed', hovered: target });
  });

  it('hover while idle returns the same state', () => {
    const target = document.createElement('div');
    const next = pinReducer(IDLE, { type: 'hover', target });
    expect(next).toBe(IDLE);
  });

  it('pin while armed records the element and the offset', () => {
    const target = document.createElement('div');
    const armed: PinState = { phase: 'armed', hovered: target };
    const offset = { x: 5, y: 7 };
    const next = pinReducer(armed, { type: 'pin', target, offset });
    expect(next).toEqual({ phase: 'pinned', element: target, offset });
  });

  it('pin with no target stays armed', () => {
    const armed: PinState = { phase: 'armed', hovered: null };
    const next = pinReducer(armed, { type: 'pin', target: null, offset: { x: 0, y: 0 } });
    expect(next).toBe(armed);
  });

  it('cancel while armed returns to idle', () => {
    const armed: PinState = { phase: 'armed', hovered: null };
    const next = pinReducer(armed, { type: 'cancel' });
    expect(next).toBe(IDLE);
  });

  it('cancel after a pin returns to idle', () => {
    const target = document.createElement('div');
    const pinned: PinState = { phase: 'pinned', element: target, offset: { x: 0, y: 0 } };
    const next = pinReducer(pinned, { type: 'cancel' });
    expect(next).toBe(IDLE);
  });

  it('arm after a pin starts a new pin', () => {
    const target = document.createElement('div');
    const pinned: PinState = { phase: 'pinned', element: target, offset: { x: 0, y: 0 } };
    const next = pinReducer(pinned, { type: 'arm' });
    expect(next).toEqual({ phase: 'armed', hovered: null });
  });
});

describe('pinTarget', () => {
  it('pinTarget returns the first element on the path', () => {
    const host = document.createElement('div');
    const el = document.createElement('button');
    const path = [el, document.body, document.documentElement, document];
    expect(pinTarget(path, host)).toBe(el);
  });

  it('pinTarget returns null when the path passes through the widget host', () => {
    const host = document.createElement('div');
    const el = document.createElement('button');
    const path = [el, host, document.body, document.documentElement, document];
    expect(pinTarget(path, host)).toBeNull();
  });

  it('pinTarget skips text nodes, the document and the window', () => {
    const host = document.createElement('div');
    const text = document.createTextNode('hello');
    const el = document.createElement('button');
    const path: EventTarget[] = [text, document, window, el, document.body];
    expect(pinTarget(path, host)).toBe(el);
  });
});

describe('pointOffset', () => {
  it('pointOffset is the point relative to the element rect', () => {
    const el = document.createElement('div');
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

    const offset = pointOffset(el, 15, 27);

    expect(offset).toEqual({ x: 5, y: 7 });
  });
});
