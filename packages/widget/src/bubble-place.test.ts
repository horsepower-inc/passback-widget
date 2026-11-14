// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fitBeside, placeBeside } from './bubble-place';

const size = { width: 300, height: 200 };
const view = { width: 1000, height: 800 };

describe('fitBeside', () => {
  it('keeps the default place when the bubble fits', () => {
    expect(fitBeside({ x: 100, y: 100 }, size, view, 8)).toEqual({});
  });

  it('flips left of the pin when it would overflow the right edge', () => {
    expect(fitBeside({ x: 900, y: 100 }, size, view, 8)).toEqual({ left: 592 });
  });

  it('moves up when it would overflow the bottom edge', () => {
    expect(fitBeside({ x: 100, y: 700 }, size, view, 8)).toEqual({ top: 592 });
  });

  it('clamps to the gap when the pin is nearer the left edge than the bubble is wide', () => {
    expect(fitBeside({ x: 100, y: 100 }, size, { width: 350, height: 800 }, 8)).toEqual({
      left: 8,
    });
  });
});

describe('placeBeside', () => {
  it('writes the flipped pixel position onto the element', () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    element.getBoundingClientRect = () => ({ width: 300, height: 200 }) as DOMRect;
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    placeBeside(element, { x: 900, y: 700 });
    expect(element.style.left).toBe('592px');
    expect(element.style.top).toBe('592px');
  });
});
