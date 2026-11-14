// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { shotMaskRects } from '@passback/collectors/shot-mask';
import { mountVeil, type Veil } from './shot-veil';

vi.mock('@passback/collectors/shot-mask', () => ({ shotMaskRects: vi.fn() }));

let host: HTMLElement;
let root: ShadowRoot;
let veil: Veil;
let frame: FrameRequestCallback | undefined;
const masks = vi.mocked(shotMaskRects);

beforeEach(() => {
  masks.mockReset().mockReturnValue([
    { x: 12, y: 34, width: 56, height: 78 },
    { x: 90, y: 10, width: 20, height: 30 },
  ]);
  frame = undefined;
  vi.spyOn(window, 'addEventListener');
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frame = callback;
    return 7;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    frame = undefined;
  });
  host = document.createElement('div');
  document.body.append(host);
  root = host.attachShadow({ mode: 'open' });
  root.append(document.createElement('textarea'));
  veil = mountVeil(root, window, host);
});

afterEach(() => {
  veil.destroy();
  host.remove();
  vi.restoreAllMocks();
});

it('covers each private field with a black box at its place', () => {
  const container = root.querySelector<HTMLElement>('[data-role="veil"]')!;
  expect(root.firstChild).toBe(container);
  expect(Array.from(container.children, (child) => (child as HTMLElement).style.cssText)).toEqual([
    'position: absolute; background: #000; left: 12px; top: 34px; width: 56px; height: 78px;',
    'position: absolute; background: #000; left: 90px; top: 10px; width: 20px; height: 30px;',
  ]);
  const oldBox = container.firstChild;
  masks.mockReturnValue([{ x: 1, y: 2, width: 3, height: 4 }]);
  veil.refresh();
  expect(container.children).toHaveLength(1);
  expect(container.contains(oldBox)).toBe(false);
  expect((container.firstChild as HTMLElement).style.left).toBe('1px');
  masks.mockReturnValue([]);
  veil.refresh();
  expect(container.children).toHaveLength(0);
});

it('asks for the whole viewport and leaves the widget host out', () => {
  expect(masks).toHaveBeenCalledExactlyOnceWith(
    document,
    { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
    host,
  );
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
  veil.refresh();
  expect(masks).toHaveBeenLastCalledWith(document, { x: 0, y: 0, width: 800, height: 600 }, host);
});

it('takes no pointer input and is hidden from assistive technology', () => {
  const container = root.querySelector<HTMLElement>('[data-role="veil"]')!;
  expect(container.getAttribute('aria-hidden')).toBe('true');
  expect(container.style.cssText).toBe('position: fixed; inset: 0; pointer-events: none;');
});

it('recomputes once per frame after a scroll or a resize', () => {
  expect(window.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), {
    capture: true,
    passive: true,
  });
  const inner = document.createElement('div');
  host.append(inner);
  inner.dispatchEvent(new Event('scroll', { bubbles: false }));
  window.dispatchEvent(new Event('resize'));
  window.dispatchEvent(new Event('scroll'));
  expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  expect(masks).toHaveBeenCalledTimes(1);
  frame!(0);
  expect(masks).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new Event('resize'));
  expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);
  frame!(16);
  expect(masks).toHaveBeenCalledTimes(3);
});

it('removes the covers and the listeners on destroy, also when called twice', () => {
  const remove = vi.spyOn(window, 'removeEventListener');
  window.dispatchEvent(new Event('scroll'));
  veil.destroy();
  veil.destroy();
  expect(window.cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(7);
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), true);
  expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
  expect(root.querySelector('[data-role="veil"]')).toBeNull();
  expect(root.querySelector('textarea')).not.toBeNull();
  window.dispatchEvent(new Event('scroll'));
  window.dispatchEvent(new Event('resize'));
  expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  expect(masks).toHaveBeenCalledTimes(1);
});
