// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountInk, type Ink } from './shot-ink';
import { shapePath } from './shot-shapes';

let host: HTMLElement;
let root: ShadowRoot;
let svg: SVGSVGElement;
let ink: Ink;
const changed = vi.fn();

function pointer(type: string, init: PointerEventInit = {}): PointerEvent {
  const event = new PointerEvent(type, {
    pointerId: 1,
    pointerType: 'mouse',
    clientX: 10,
    clientY: 20,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  svg.dispatchEvent(event);
  return event;
}

function drag(init: PointerEventInit = {}): void {
  pointer('pointerdown', init);
  pointer('pointermove', { clientX: 40, clientY: 60, ...init });
  pointer('pointerup', { clientX: 40, clientY: 60, ...init });
}

beforeEach(() => {
  changed.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = host.attachShadow({ mode: 'open' });
  root.append(document.createElement('textarea'));
  vi.spyOn(window, 'scrollX', 'get').mockReturnValue(5);
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(10);
  ink = mountInk(root, window, changed);
  svg = root.querySelector('svg')!;
});

afterEach(() => {
  ink.destroy();
  host.remove();
  vi.restoreAllMocks();
});

describe('shot-ink', () => {
  it('lays the layer under everything else in the shadow root and hides it from assistive technology', () => {
    expect(root.firstChild).toBe(svg);
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.dataset.role).toBe('ink');
    expect(svg.style.position).toBe('fixed');
    expect(svg.style.pointerEvents).toBe('auto');
    expect(svg.style.cssText).toContain('touch-action: none');
    expect(ink.tool).toBe('arrow');
  });

  it('draws an arrow from a pointer drag and reports one shape', () => {
    svg.setPointerCapture = vi.fn(() => {
      throw new Error('synthetic pointer');
    });
    expect(pointer('pointerdown').defaultPrevented).toBe(true);
    pointer('pointermove', { clientX: 40, clientY: 60 });
    expect(svg.children).toHaveLength(1);
    expect(ink.shapes()).toEqual([]);
    pointer('pointerup');
    expect(svg.setPointerCapture).toHaveBeenCalledWith(1);
    expect(ink.shapes()).toEqual([{ tool: 'arrow', from: { x: 10, y: 20 }, to: { x: 40, y: 60 } }]);
    expect(svg.firstElementChild?.getAttribute('d')).toBe(shapePath(ink.shapes()[0]!));
    expect(changed.mock.calls).toEqual([[1]]);
  });

  it('draws a line and a box when the tool is changed', () => {
    ink.tool = 'line';
    drag({ pointerType: 'touch' });
    ink.tool = 'box';
    drag({ pointerType: 'pen' });
    expect(ink.shapes().map((shape) => shape.tool)).toEqual(['line', 'box']);
    expect(Array.from(svg.children, (path) => path.getAttribute('d'))).toEqual([
      'M10 20L40 60',
      'M10 20H40V60H10Z',
    ]);
    expect(changed.mock.calls).toEqual([[1], [2]]);
  });

  it('ignores a drag shorter than 6 px, a second pointer and a non-primary mouse button', () => {
    pointer('pointerdown');
    pointer('pointermove', { clientX: 13, clientY: 24 });
    pointer('pointerup');
    drag({ button: 2 });
    expect(ink.shapes()).toEqual([]);
    pointer('pointerdown', { pointerType: 'touch' });
    drag({ pointerId: 2, pointerType: 'touch' });
    pointer('pointercancel', { pointerId: 2 });
    pointer('pointermove', { clientX: 40, clientY: 60 });
    pointer('pointerup');
    expect(ink.shapes()).toHaveLength(1);
    expect(changed.mock.calls).toEqual([[1]]);
  });

  it('drops the stroke on pointer cancel', () => {
    pointer('pointerdown');
    pointer('pointermove', { clientX: 40 });
    pointer('pointercancel');
    pointer('pointerup');
    expect(svg.children).toHaveLength(0);
    expect(ink.shapes()).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
  });

  it('drops a stroke in progress on Escape and keeps the key from the comment box', () => {
    const textarea = root.querySelector('textarea')!;
    const listener = vi.fn();
    textarea.addEventListener('keydown', listener);
    pointer('pointerdown');
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }),
    );
    expect(svg.children).toHaveLength(1);
    listener.mockClear();
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    textarea.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect(svg.children).toHaveLength(0);
    pointer('pointerup');
    expect(changed).not.toHaveBeenCalled();
  });

  it('lets Escape through when no stroke is in progress', () => {
    const textarea = root.querySelector('textarea')!;
    const listener = vi.fn();
    textarea.addEventListener('keydown', listener);
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    textarea.dispatchEvent(escape);
    expect(listener).toHaveBeenCalledOnce();
    expect(escape.defaultPrevented).toBe(false);
  });

  it('moves the shapes with the page when the window scrolls', () => {
    drag();
    pointer('pointerdown');
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(15);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(30);
    window.dispatchEvent(new Event('scroll'));
    expect(ink.shapes()[0]).toEqual({ tool: 'arrow', from: { x: 0, y: 0 }, to: { x: 30, y: 40 } });
    expect(svg.children).toHaveLength(1);
    pointer('pointerup');
    window.dispatchEvent(new Event('scroll'));
    expect(ink.shapes()[0]?.from).toEqual({ x: 0, y: 0 });
    expect(svg.firstElementChild?.getAttribute('d')).toBe(shapePath(ink.shapes()[0]!));
    expect(changed.mock.calls).toEqual([[1]]);
  });

  it('takes no pointer input while inactive and keeps the shapes visible', () => {
    drag();
    pointer('pointerdown');
    ink.setActive(false);
    expect(svg.style.pointerEvents).toBe('none');
    drag();
    expect(svg.children).toHaveLength(1);
    expect(ink.shapes()).toHaveLength(1);
    ink.setActive(true);
    expect(svg.style.pointerEvents).toBe('auto');
    drag();
    expect(changed.mock.calls).toEqual([[1], [2]]);
  });

  it('undo removes the last shape and clear removes all, each reporting the new count', () => {
    ink.undo();
    ink.clear();
    drag();
    ink.tool = 'box';
    drag();
    ink.undo();
    expect(ink.shapes().map((shape) => shape.tool)).toEqual(['arrow']);
    expect(svg.children).toHaveLength(1);
    ink.clear();
    ink.clear();
    expect(ink.shapes()).toEqual([]);
    expect(svg.children).toHaveLength(0);
    expect(changed.mock.calls).toEqual([[1], [2], [1], [0]]);
  });

  it('removes the layer and its listeners on destroy, also when called twice, and keeps the shapes readable', () => {
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const removeLayer = vi.spyOn(svg, 'removeEventListener');
    drag();
    const shapes = ink.shapes();
    pointer('pointerdown');
    ink.destroy();
    ink.destroy();
    expect(removeWindow).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(removeWindow).toHaveBeenCalledWith('scroll', expect.any(Function));
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      expect(removeLayer).toHaveBeenCalledWith(type, expect.any(Function));
    }
    expect(root.querySelector('svg')).toBeNull();
    drag();
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(100);
    window.dispatchEvent(new Event('scroll'));
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(ink.shapes()).toBe(shapes);
    expect(changed.mock.calls).toEqual([[1]]);
  });
});
