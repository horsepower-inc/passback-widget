// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dockAbove, undock } from './bubble-dock';
import { createBubble } from './bubble-view';
import { createTray } from './tray-view';

// No layout in happy-dom: the tray sits 120 px above the bottom, 260 px tall,
// a 36 px pill with data-squeezed; the bubble is 300 px tall.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const tray = this.classList.contains('pb-tray');
    const height = tray ? (this.hasAttribute('data-squeezed') ? 36 : 260) : 300;
    return { top: window.innerHeight - 120 - height, height } as DOMRect;
  });
});

afterEach(() => vi.restoreAllMocks());

function setup(innerHeight: number, kept: number) {
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
  const root = document.createElement('div').attachShadow({ mode: 'open' });
  const tray = createTray(root, { onSendAll: vi.fn() });
  const rows = Array.from({ length: kept }, (_, i) => ({ n: i + 1, comment: 'c', act: vi.fn() }));
  tray.render(rows);
  const bubble = root.appendChild(document.createElement('div'));
  return { root, tray: tray.element, bubble };
}

const at = (px: number): string => `calc(${px}px + var(--pb-space-gap))`;

it('docks the bubble above the tray at 360 px', () => {
  const { root, tray, bubble } = setup(740, 1);
  dockAbove(bubble, root);
  expect([bubble.style.bottom, tray.hasAttribute('data-squeezed')]).toEqual([at(380), false]);
});

it('squeezes the tray at 320 px with three kept comments', () => {
  const { root, tray, bubble } = setup(568, 3);
  dockAbove(bubble, root);
  expect([bubble.style.bottom, tray.hasAttribute('data-squeezed')]).toEqual([at(156), true]);
  expect(568 - 156 - 8 - 300).toBeGreaterThanOrEqual(0);
});

it('leaves the docked bubble in place with no tray', () => {
  const { root, bubble } = setup(740, 0);
  bubble.style.bottom = '10px';
  dockAbove(bubble, root);
  expect(bubble.style.bottom).toBe('');
});

it('undocks without leaving a bottom or data-squeezed behind', () => {
  const { root, tray, bubble } = setup(568, 3);
  dockAbove(bubble, root);
  undock(bubble, root);
  expect([bubble.style.bottom, tray.hasAttribute('data-squeezed')]).toEqual(['', false]);
});

it('redocks a squeezed tray without overlapping the bubble', () => {
  const { root, tray, bubble } = setup(568, 3);
  dockAbove(bubble, root);
  Object.defineProperty(window, 'innerHeight', { value: 740, configurable: true });
  dockAbove(bubble, root);
  expect([bubble.style.bottom, tray.hasAttribute('data-squeezed')]).toEqual([at(380), false]);
});

function mount(onDiscard?: () => void) {
  const { root, tray } = setup(568, 3);
  tray.setAttribute('data-collapsed', '');
  const opts = { anchor: { x: 0, y: 0 }, onSend: vi.fn(), onCancel: vi.fn(), onDiscard };
  const bubble = createBubble(root, { ...opts, viewportWidth: () => 360 });
  expect(tray.hasAttribute('data-squeezed')).toBe(true);
  return { root, tray, bubble };
}

it('destroy returns a squeezed tray to its stored collapsed choice', () => {
  const { root, tray, bubble } = mount();
  bubble.destroy();
  expect([tray.hasAttribute('data-squeezed'), tray.hasAttribute('data-collapsed')]).toEqual([
    false,
    true,
  ]);
  expect(root.querySelector('.pb-bubble')).toBeNull();
});

it('destroy through onDiscard releases the squeezed tray', () => {
  const ref: { destroy?: () => void } = {};
  const { root, tray, bubble } = mount(() => ref.destroy?.());
  ref.destroy = bubble.destroy;
  root.querySelector<HTMLElement>('[data-role="discard"]')!.click();
  expect([tray.hasAttribute('data-squeezed'), tray.hasAttribute('data-collapsed')]).toEqual([
    false,
    true,
  ]);
  expect(root.querySelector('.pb-bubble')).toBeNull();
});
