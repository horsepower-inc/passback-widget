// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';
import { CLASS } from './styles';
import { targetOutline } from './target-outline';

const scope = globalThis as { __passback?: unknown };
let overlays: Overlay[] = [];

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});
afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  delete scope.__passback;
  document.body.innerHTML = '';
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const rectOf = (l: number, t: number, w: number, h: number) =>
  ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t }) as DOMRect;
const place = (el: Element, l: number, t: number, w: number, h: number) =>
  void (el.getBoundingClientRect = () => rectOf(l, t, w, h));
const box = (l: number, t: number, w: number, h: number) => {
  const el = document.createElement('div');
  place(el, l, t, w, h);
  return el;
};

function open() {
  scope.__passback = { fx: { addons: [targetOutline] } };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    targetOf: () => ({ tag: 'div' }) as never,
    onSubmit: vi.fn(),
  });
  overlays.push(overlay);
  const dots = () => [...root.querySelectorAll<HTMLElement>(`.${CLASS.dot}`)];
  const q = <E extends Element>(s: string) => root.querySelector<E>(s);
  const outline = () => q<HTMLElement>('.pb-target-outline')!;
  const shown = () => !outline().hidden && outline().style.display !== 'none';
  const rect = () => [
    outline().style.left,
    outline().style.top,
    outline().style.width,
    outline().style.height,
  ];
  // Writes a comment on `target` (clicked at 300, 400); `keepIt` keeps it.
  const write = (target: HTMLElement, keepIt = false) => {
    if (overlay.phase() === 'idle') overlay.arm();
    document.body.appendChild(target);
    target.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, clientX: 300, clientY: 400 }),
    );
    const input = q<HTMLTextAreaElement>('textarea')!;
    input.value = 'c';
    input.dispatchEvent(new Event('input'));
    if (keepIt) q<HTMLElement>('button[data-role="add-more"]')!.click();
  };
  const over = (el: Element, type = 'pointerover', related?: Element) => {
    const event = new Event(type, { bubbles: true, composed: true });
    Object.defineProperty(event, 'relatedTarget', { value: related ?? null });
    el.dispatchEvent(event);
  };
  const highlight = (detail: unknown) =>
    host.dispatchEvent(new CustomEvent('passback:highlight', { detail }));
  return { host, root, overlay, dots, q, outline, shown, rect, write, over, highlight };
}

/** Two sent marks m1 on a, m2 on b, then a third being written on c. */
async function three() {
  const o = open();
  const a = box(100, 100, 50, 40);
  const b = box(300, 200, 60, 30);
  const c = box(500, 300, 70, 20);
  for (const [target, id] of [
    [a, 'm1'],
    [b, 'm2'],
  ] as const) {
    o.write(target);
    o.q<HTMLTextAreaElement>('textarea')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    );
    o.overlay.acked(id, false);
  }
  o.write(c);
  await flush();
  return { ...o, a, b, c };
}

describe('target outline', () => {
  it('outlines the target of a hovered mark and removes the outline when the pointer leaves', async () => {
    const o = open();
    o.write(box(200, 200, 100, 60), true);
    await flush();
    expect(o.shown()).toBe(false);
    const [pin] = o.dots();
    o.over(pin!);
    expect(o.shown()).toBe(true);
    expect(o.rect()).toEqual(['200px', '200px', '100px', '60px']);
    o.over(pin!, 'pointerout', pin!);
    expect(o.shown()).toBe(true);
    o.over(pin!, 'pointerout');
    expect(o.shown()).toBe(false);
  });

  it('outlines the target of the mark being written and removes it when the comment is kept', async () => {
    const o = open();
    o.write(box(200, 200, 100, 60));
    await flush();
    expect(o.shown()).toBe(true);
    expect(o.rect()).toEqual(['200px', '200px', '100px', '60px']);
    o.q<HTMLElement>('button[data-role="add-more"]')!.click();
    await flush();
    expect(o.shown()).toBe(false);
  });

  it('outlines the mark named by passback:highlight and clears it on a null id', async () => {
    const o = await three();
    o.highlight({ id: 'm1' });
    expect(o.shown()).toBe(true);
    expect(o.rect()).toEqual(['100px', '100px', '50px', '40px']);
    o.highlight({ id: 'nope' });
    expect(o.rect()).toEqual(['100px', '100px', '50px', '40px']);
    o.highlight('bad');
    o.highlight(null);
    expect(o.rect()).toEqual(['100px', '100px', '50px', '40px']);
    o.highlight({ id: null });
    // Falls back to the mark being written.
    expect(o.rect()).toEqual(['500px', '300px', '70px', '20px']);
  });

  it('shows the hovered mark before a highlighted one and the highlighted one before the selected one', async () => {
    const o = await three();
    expect(o.rect()).toEqual(['500px', '300px', '70px', '20px']);
    o.highlight({ id: 'm1' });
    expect(o.rect()).toEqual(['100px', '100px', '50px', '40px']);
    o.over(o.dots()[1]!);
    expect(o.rect()).toEqual(['300px', '200px', '60px', '30px']);
    o.over(o.dots()[1]!, 'pointerout');
    expect(o.rect()).toEqual(['100px', '100px', '50px', '40px']);
    o.highlight({ id: null });
    expect(o.rect()).toEqual(['500px', '300px', '70px', '20px']);
  });

  it('follows the target on scroll and resize and hides when the target is gone or cannot be measured', async () => {
    const o = open();
    const target = box(200, 200, 100, 60);
    o.write(target, true);
    await flush();
    o.over(o.dots()[0]!);
    place(target, 200, 100, 100, 60);
    window.dispatchEvent(new Event('scroll'));
    expect(o.rect()).toEqual(['200px', '100px', '100px', '60px']);
    place(target, 10, 20, 30, 40);
    window.dispatchEvent(new Event('resize'));
    expect(o.rect()).toEqual(['10px', '20px', '30px', '40px']);
    place(target, 10, -41, 30, 40);
    window.dispatchEvent(new Event('scroll'));
    expect(o.shown()).toBe(false);
    place(target, 10, 800, 30, 40);
    window.dispatchEvent(new Event('scroll'));
    expect(o.shown()).toBe(false);
    place(target, -30, 20, 30, 40);
    window.dispatchEvent(new Event('resize'));
    expect(o.shown()).toBe(false);
    place(target, 1000, 20, 30, 40);
    window.dispatchEvent(new Event('resize'));
    expect(o.shown()).toBe(false);
    place(target, 10, -39, 30, 40);
    window.dispatchEvent(new Event('scroll'));
    expect(o.shown()).toBe(true);
    place(target, 10, 20, 0, 0);
    window.dispatchEvent(new Event('scroll'));
    expect(o.shown()).toBe(false);
    place(target, 10, 20, Number.NaN, 5);
    window.dispatchEvent(new Event('passback:sync'));
    o.host.dispatchEvent(new Event('passback:sync'));
    expect(o.shown()).toBe(false);
    place(target, 10, 20, 30, 40);
    o.host.dispatchEvent(new Event('passback:sync'));
    expect(o.shown()).toBe(true);
    target.getBoundingClientRect = () => {
      throw new Error('boom');
    };
    expect(() => window.dispatchEvent(new Event('scroll'))).not.toThrow();
    expect(o.shown()).toBe(false);
    place(target, 10, 20, 30, 40);
    o.host.dispatchEvent(new Event('passback:sync'));
    target.remove();
    o.host.dispatchEvent(new Event('passback:sync'));
    expect(o.shown()).toBe(false);
  });

  it('draws a thin outline from tokens only and keeps the pointer and the hide key out of its way', () => {
    const o = open();
    const text = o.q('style[data-pb-target-outline-styles]')!.textContent!;
    expect(text).toContain('1.5px solid var(--pb-color-accent)');
    expect(text).toContain('outline-offset: 2px');
    expect(text).toContain('pointer-events: none');
    expect(text).toContain('data-pb-hide');
    expect(text).not.toMatch(/#[0-9a-fA-F]+/);
    expect(text).not.toContain('rgb(');
    expect(o.outline().getAttribute('part')).toBe('target-outline');
  });

  it('removes its node, style and listeners on dispose', async () => {
    const o = open();
    const target = box(200, 200, 100, 60);
    o.write(target, true);
    await flush();
    const [pin] = o.dots();
    o.host.dispatchEvent(new Event('passback:dispose'));
    expect(o.q('.pb-target-outline')).toBeNull();
    expect(o.q('[data-pb-target-outline-styles]')).toBeNull();
    expect(() => o.over(pin!)).not.toThrow();
    expect(() => o.highlight({ id: 'm1' })).not.toThrow();
    expect(() => window.dispatchEvent(new Event('scroll'))).not.toThrow();
    expect(o.q('.pb-target-outline')).toBeNull();
  });
});
