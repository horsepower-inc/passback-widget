// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cornerPins } from './corner-pins';
import { createOverlay } from './overlay';
import { CLASS } from './styles';

const scope = globalThis as { __passback?: unknown };
const frames = new Map<number, FrameRequestCallback>();
const opts = { selectorOf: () => 'div', targetOf: () => ({ tag: 'div' }) as never };
const viewport = (innerWidth: number, innerHeight: number) =>
  Object.assign(window, { innerWidth, innerHeight });
let id = 1;
let destroy = (): void => {};
beforeEach(() => {
  viewport(1000, 800);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => (frames.set(id, cb), id++));
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((n) => void frames.delete(n));
});
afterEach(() => {
  destroy();
  frames.clear();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  delete scope.__passback;
});
const run = (): void => [...frames].forEach(([n, cb]) => (frames.delete(n), cb(0)));
const at = (el: Element, left: number, top: number, [width, height] = [100, 60]): void => {
  const r = { left, top, right: left + width!, bottom: top + height!, width, height };
  el.getBoundingClientRect = () => r as DOMRect;
};
/** Dispatches one event on `on`, then runs the queued frame. */
const fire = (type = 'scroll', on: EventTarget = window): void => {
  on.dispatchEvent(new Event(type));
  run();
};
const gap = (v: string) => `calc(${Number.parseFloat(v) + 8}px + var(--pb-space-gap))`;
const beside = (bubble: HTMLElement, pin: HTMLElement): void =>
  expect([bubble.style.left, bubble.style.top]).toEqual([pin.style.left, pin.style.top].map(gap));

/** n marks in a row; with two, the first is kept and its bubble open again beside the composer. */
async function open(n: number, parent: Element = document.body) {
  scope.__passback = { fx: { addons: [cornerPins] } };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({ doc: document, root, host, onSubmit: vi.fn(), ...opts });
  destroy = () => overlay.destroy();
  const q = (s: string) => [...root.querySelectorAll<HTMLElement>(s)];
  const els: HTMLElement[] = [];
  const bubbles: HTMLElement[] = [];
  for (let i = 0; i < n; i += 1) {
    if (i > 0) q('[data-role="add-more"]')[0]!.click();
    overlay.arm();
    const el = parent.appendChild(document.createElement('div'));
    at(el, 200 + i * 300, 300);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 300, clientY: 400 }));
    const input = q('textarea')[0] as HTMLTextAreaElement;
    input.value = `draft ${i}`;
    input.dispatchEvent(new Event('input'));
    els.push(el);
    bubbles.push(q(`.${CLASS.bubble}`).at(-1)!);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (n > 1) root.append(bubbles[0]!);
  run();
  return { host, root, els, bubbles, dots: q(`.${CLASS.dot}`) };
}

it('moves each open bubble with its own pin on window and ancestor scroll', async () => {
  const scroller = document.body.appendChild(document.createElement('section'));
  const { root, els, bubbles, dots } = await open(2, scroller);
  for (const on of [window, scroller]) {
    const top = on === window ? 180 : 130;
    els.forEach((el, i) => at(el, 200 + i * 300, top));
    fire('scroll', on); // the ancestor's scroll does not bubble; the window captures it
    expect(dots.map((d) => d.style.top)).toEqual([`${top - 16}px`, `${top - 16}px`]);
    bubbles.forEach((b, i) => beside(b, dots[i]!));
  }
  expect(root.querySelector('textarea')!.value).toBe('draft 1');
});

it('repositions on resize and restores an undocked bubble after its target returns', async () => {
  const { els, bubbles, dots } = await open(1);
  const [a, bubble, pin] = [els[0]!, bubbles[0]!, dots[0]!];
  viewport(600, 500);
  at(bubble, 0, 0, [200, 100]);
  at(a, 450, 400);
  fire('resize');
  // Flipped left of the pin and lifted to fit the 600x500 viewport.
  const [left, top] = [bubble.style.left, bubble.style.top].map(Number.parseFloat);
  expect(left).toBeLessThanOrEqual(Number.parseFloat(pin.style.left) + 9);
  expect(top).toBeLessThanOrEqual(500 - 8 - 100 + 1);
  for (const y of [-500, 2000]) {
    at(a, 450, y);
    fire();
    expect([bubble.style.visibility, bubble.hidden]).toEqual(['hidden', false]);
  }
  at(a, 100, 200);
  fire();
  expect(bubble.style.visibility).toBe('');
  beside(bubble, pin);
});

it('keeps a docked bubble docked while its target scrolls away', async () => {
  viewport(400, 700);
  const { els, bubbles } = await open(1);
  const look = () => [bubbles[0]!.dataset.docked, bubbles[0]!.style.cssText, bubbles[0]!.hidden];
  const before = look();
  at(els[0]!, 100, -900);
  fire();
  expect([before[0], look()]).toEqual(['', before]);
});

it('coalesces bubble updates isolates bad targets and cancels work on disposal', async () => {
  const { host, els, bubbles, dots } = await open(2);
  const [a, b, first, second] = [els[0]!, els[1]!, bubbles[0]!, bubbles[1]!];
  ['scroll', 'resize', 'scroll'].forEach((t) => window.dispatchEvent(new Event(t)));
  expect(frames.size).toBe(1);
  at(a, 200, 50);
  at(b, 500, 100);
  run();
  expect(dots[1]!.style.top).toBe('84px'); // measured when the frame ran, not at the events
  const thrower = (): DOMRect => JSON.parse('{');
  const breaks = [
    () => at(b, NaN, 0),
    () => at(b, 5, 5, [0, 0]),
    () => b.remove(),
    () => (b.getBoundingClientRect = thrower),
  ];
  for (const [i, breakIt] of breaks.entries()) {
    document.body.append(b);
    at(b, 500, 200 + i);
    fire();
    expect(second.style.visibility).toBe(''); // a valid measurement recovers it
    beside(second, dots[1]!);
    breakIt();
    at(a, 200, 60 + i);
    expect(fire).not.toThrow();
    expect([second.style.visibility, dots[0]!.style.top]).toEqual(['hidden', `${44 + i}px`]);
    beside(first, dots[0]!);
  }
  window.dispatchEvent(new Event('scroll'));
  host.dispatchEvent(new Event('passback:dispose'));
  expect([frames.size, second.style.visibility]).toEqual([0, '']);
  const stale = second.style.cssText;
  at(b, 500, 20);
  fire('resize');
  fire();
  expect([frames.size, second.style.cssText]).toEqual([0, stale]);
});
