// @vitest-environment happy-dom
import { beforeEach, expect, it, type Mock, vi } from 'vitest';
import { Celebration } from './completion';
import { createDot } from './dot-view';
import { createLauncher } from './launcher';

const noop = (): void => undefined;
type Fake = { onfinish?: () => void } & Record<string, Mock>;
let [frames, anims] = [[] as FrameRequestCallback[], [] as Fake[]];

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { __passback?: unknown }).__passback = {
    fx: { celebrate: (...a: ConstructorParameters<typeof Celebration>) => new Celebration(...a) },
  };
  [frames, anims] = [[], []];
  window.requestAnimationFrame = (cb) => frames.push(cb);
  window.cancelAnimationFrame = (id) => void (frames[id - 1] = noop);
  window.matchMedia = (() => ({ matches: false })) as never;
  HTMLElement.prototype.animate = function (this: Element, keys: unknown) {
    const fake = { el: this, keys, cancel: vi.fn(), setKeyframes: vi.fn() } as unknown as Fake;
    anims.push(fake);
    return Object.assign(fake, { effect: fake }) as never;
  };
});

it('R4b falls back to the static stamp when the flight cancel throws but animate works', () => {
  const root = document.body
    .appendChild(document.createElement('div'))
    .attachShadow({ mode: 'open' });
  const { element } = createLauncher(root, noop);
  element.getBoundingClientRect = () => ({ left: 300, top: 500, width: 36, height: 36 }) as DOMRect;
  const dot = createDot(root, { x: 1, y: 1 });
  dot.setState('done');
  frames.splice(0).forEach((cb) => cb(0));
  anims[0]?.cancel?.mockImplementation(() => {
    throw new Error('cannot cancel');
  });
  expect(() => anims[0]?.onfinish?.()).not.toThrow();
  const stamps = [...root.querySelectorAll('.pb-stamp')].map(
    (s) => `${s.textContent}${s.hasAttribute('data-pb-static') ? ' static' : ''}`,
  );
  expect(stamps).toEqual(['FIXED ✓ static']);
  expect(root.querySelectorAll('.pb-cb-ray')).toHaveLength(0);
  expect(root.querySelectorAll('.pb-cb-shot')).toHaveLength(0);
  expect(anims).toHaveLength(1);
});
