// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cornerPins } from './corner-pins';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';
import { CLASS } from './styles';

const scope = globalThis as { __passback?: unknown };
let overlays: Overlay[] = [];

const viewport = (w: number, h: number) => {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
};
beforeEach(() => viewport(1000, 800));
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

function open(registered = true) {
  if (registered) scope.__passback = { fx: { addons: [cornerPins] } };
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
  // Keeps one comment on `target`, clicked at (300, 400).
  const keep = (target: HTMLElement) => {
    if (overlay.phase() === 'idle') overlay.arm();
    document.body.appendChild(target);
    target.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, clientX: 300, clientY: 400 }),
    );
    const input = q<HTMLTextAreaElement>('textarea')!;
    input.value = 'c';
    input.dispatchEvent(new Event('input'));
    q<HTMLElement>('button[data-role="add-more"]')!.click();
  };
  const at = (el: HTMLElement) => [el.style.left, el.style.top];
  return { host, root, overlay, dots, q, keep, at };
}

const box = (l: number, t: number, w: number, h: number) => {
  const el = document.createElement('div');
  place(el, l, t, w, h);
  return el;
};

describe('corner pins', () => {
  it('places a numbered pin outside a target corner', async () => {
    const { keep, dots, at } = open();
    keep(box(200, 200, 100, 60));
    await flush();
    const [pin] = dots();
    expect(at(pin!)).toEqual(['184px', '184px']);
    expect(pin!.getAttribute('data-corner-pin')).toBe('corner');
    expect(pin!.textContent).toBe('1');
  });

  it('places a small target pin above a short leader', async () => {
    const { keep, dots, at, root } = open();
    keep(box(200, 200, 100, 20));
    await flush();
    const [pin] = dots();
    expect(pin!.getAttribute('data-corner-pin')).toBe('leader');
    // Centred on x = 250, a 16 px pin and a 4 px leader above the top edge.
    expect(at(pin!)).toEqual(['242px', '180px']);
    const rules = root.querySelector('style[data-pb-corner-pins-styles]')!.textContent!;
    expect(rules).toContain('pointer-events: none');
    expect(rules).toContain('var(--pb-space-gap) / 2');
    // The status ring owns ::after, so the leader never restyles it.
    expect(rules).toContain('[data-corner-pin=leader]::before');
    expect(rules).not.toContain('::after');
  });

  it('reflects corner pins at viewport edges', async () => {
    const left = open();
    left.keep(box(5, 200, 100, 60));
    await flush();
    expect(left.at(left.dots()[0]!)).toEqual(['105px', '184px']);
    left.overlay.destroy();
    document.body.innerHTML = '';
    const top = open();
    top.keep(box(200, 5, 100, 60));
    await flush();
    expect(top.at(top.dots()[0]!)).toEqual(['184px', '65px']);
    top.overlay.destroy();
    document.body.innerHTML = '';
    const both = open();
    both.keep(box(5, 5, 100, 60));
    await flush();
    expect(both.at(both.dots()[0]!)).toEqual(['105px', '65px']);
  });

  it('stacks two pins sideways and closes the removed slot', async () => {
    const { keep, dots, at, q } = open();
    const target = box(200, 200, 100, 60);
    keep(target);
    keep(target);
    await flush();
    expect(dots().map(at)).toEqual([
      ['184px', '184px'],
      ['168px', '184px'],
    ]);
    q<HTMLElement>('.pb-list li button')!.click();
    await flush();
    expect(dots().map(at)).toEqual([['184px', '184px']]);
    expect(dots()[0]!.textContent).toBe('1');
  });

  it('hides a pin when no outside viewport position fits', async () => {
    const { keep, dots } = open();
    const target = box(0, 0, 1000, 800);
    keep(target);
    await flush();
    const [pin] = dots();
    expect(pin!.hasAttribute('hidden')).toBe(true);
    place(target, 200, 200, 100, 60);
    window.dispatchEvent(new Event('resize'));
    expect(pin!.hasAttribute('hidden')).toBe(false);
  });

  it('updates corner placement after scroll resize and reattachment', async () => {
    const { keep, dots, at, overlay } = open();
    const target = box(200, 200, 100, 60);
    keep(target);
    await flush();
    place(target, 200, 100, 100, 60);
    document.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('scroll'));
    expect(at(dots()[0]!)).toEqual(['184px', '84px']);
    viewport(250, 800);
    place(target, 200, 100, 40, 60);
    window.dispatchEvent(new Event('resize'));
    expect(at(dots()[0]!)).toEqual(['184px', '84px']);
    viewport(1000, 800);
    overlay.destroy();
    document.body.innerHTML = '';
    // A sent mark follows its replacement element after reattachment.
    const sent = open();
    sent.overlay.arm();
    document.body.appendChild(box(500, 300, 100, 60)).click();
    const input = sent.q<HTMLTextAreaElement>('textarea')!;
    input.value = 'x';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    sent.overlay.acked('m1', false);
    const next = document.body.appendChild(box(600, 400, 100, 60));
    const found = [{ mark: { id: 'm1', target: {} }, element: next, orphaned: false }];
    sent.overlay.reattach(found as never, { kind: 'restored' });
    await flush();
    expect(sent.dots().map(sent.at)).toEqual([['584px', '384px']]);
  });

  it('falls back safely when a target cannot be measured', async () => {
    const { keep, dots, at } = open();
    const a = box(200, 200, 100, 60);
    const b = box(400, 200, 100, 60);
    keep(a);
    keep(b);
    await flush();
    expect(at(dots()[0]!)).toEqual(['184px', '184px']);
    a.getBoundingClientRect = () => {
      throw new Error('boom');
    };
    place(b, 400, 300, 100, 60);
    expect(() => window.dispatchEvent(new Event('scroll'))).not.toThrow();
    expect(at(dots()[0]!)).toEqual(['300px', '400px']);
    expect(dots()[0]!.hasAttribute('data-corner-pin')).toBe(false);
    expect(at(dots()[1]!)).toEqual(['384px', '284px']);
    place(a, 200, 200, 0, 0);
    window.dispatchEvent(new Event('scroll'));
    expect(at(dots()[0]!)).toEqual(['300px', '400px']);
    b.remove();
    window.dispatchEvent(new Event('scroll'));
    expect(at(dots()[1]!)).toEqual(['300px', '400px']);
  });

  it('places a pin again when reattachment gives it a measurable target after a fallback', async () => {
    const { overlay, q, dots, at } = open();
    overlay.arm();
    const first = document.body.appendChild(box(500, 300, 100, 60));
    first.click();
    const input = q<HTMLTextAreaElement>('textarea')!;
    input.value = 'x';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    overlay.acked('m1', false);
    await flush();
    const [pin] = dots();
    expect(at(pin!)).toEqual(['484px', '284px']);
    place(first, 500, 300, 0, 0);
    window.dispatchEvent(new Event('scroll'));
    await flush();
    expect(pin!.hasAttribute('data-corner-pin')).toBe(false);
    expect(at(pin!)).not.toEqual(['484px', '284px']);
    const next = document.body.appendChild(box(600, 400, 100, 60));
    const found = [{ mark: { id: 'm1', target: {} }, element: next, orphaned: false }];
    overlay.reattach(found as never, { kind: 'restored' });
    await flush();
    expect(at(pin!)).toEqual(['584px', '384px']);
    expect(pin!.getAttribute('data-corner-pin')).toBe('corner');
  });

  it('keeps the clicked point until the effects chunk registers', async () => {
    const { keep, dots, at } = open(false);
    keep(box(200, 200, 100, 60));
    await flush();
    expect(at(dots()[0]!)).toEqual(['300px', '400px']);
    expect(dots()[0]!.hasAttribute('data-corner-pin')).toBe(false);
    scope.__passback = { fx: { addons: [cornerPins] } };
    document.dispatchEvent(new Event('passback:fx'));
    expect(at(dots()[0]!)).toEqual(['184px', '184px']);
  });

  it('preserves numbering and status symbols', async () => {
    const { keep, dots, overlay } = open();
    keep(box(200, 200, 100, 60));
    keep(box(400, 200, 100, 60));
    await flush();
    expect(dots().map((dot) => [dot.textContent, dot.dataset.n, dot.dataset.state])).toEqual([
      ['1', '1', 'pinned'],
      ['2', '2', 'pinned'],
    ]);
    overlay.status({ markId: 'none', state: 'done' } as never);
    expect(dots().map((dot) => dot.dataset.n)).toEqual(['1', '2']);
  });

  it('removes placement listeners and leaders on dispose', async () => {
    const { keep, dots, at, host, root } = open();
    const target = box(200, 200, 100, 20);
    keep(target);
    await flush();
    host.dispatchEvent(new Event('passback:dispose'));
    const [pin] = dots();
    expect(pin!.hasAttribute('data-corner-pin')).toBe(false);
    expect(at(pin!)).toEqual(['300px', '400px']);
    expect(root.querySelector('[data-pb-corner-pins-styles]')).toBeNull();
    place(target, 200, 100, 100, 20);
    window.dispatchEvent(new Event('scroll'));
    expect(pin!.hasAttribute('data-corner-pin')).toBe(false);
  });
});
