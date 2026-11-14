// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { overBudget, renderFrame } from './shot-dom';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));

const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
const geo = new WeakMap<Element, () => number[]>();
const at = <T extends Element>(el: T, top: number, h = 32, w = 100): T => (
  geo.set(el, () => [top, h, w]),
  el
);
const make = (tag: string, id = ''): HTMLElement => {
  const el = Object.assign(document.createElement(tag), { id });
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => Element.prototype.getBoundingClientRect.call(el),
  });
  return el;
};
const origin = <T extends Element>(el: T): T => at(el, 0, 0, 0);
const host = (): HTMLElement => make('div', 'host');
const during = <T>(read: () => T): T[] => {
  const seen: T[] = [];
  vi.mocked(toCanvas).mockImplementation(async () => (seen.push(read()), canvas));
  return seen;
};
const options = (select: HTMLElement, n: number): void => {
  const group = origin(make('optgroup'));
  for (let i = 0; i < n; i++) group.append(origin(make('option')));
  select.append(origin(make('option')), group);
};

beforeEach(async () => {
  const dom = (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM;
  dom.setViewport({ width: 1280, height: 900 });
  document.head.innerHTML = '<style>*{animation:none!important;transition:none!important}</style>';
  await document.fonts?.ready;
  document.body.replaceChildren();
  vi.mocked(toCanvas).mockReset();
  vi.mocked(toCanvas).mockResolvedValue(canvas);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const [top = 0, height = 0, width = 0] = geo.get(this)?.() ?? [];
    return { top, bottom: top + height, left: 0, right: width, width, height } as DOMRect;
  });
});
afterEach(() => vi.restoreAllMocks());

describe('shot-dom controls', () => {
  it('prunes offscreen controls and zero-area descendants after a long table run', async () => {
    const vis = at(make('div', 'vis'), 10);
    const table = at(make('table'), 950, 2400);
    const body = table.appendChild(make('tbody'));
    for (let i = 0; i < 60; i++) body.append(at(make('tr'), 950 + 40 * i, 40));
    const wrap = at(make('div', 'wrap'), 1500, 100);
    wrap.append(origin(make('div')), origin(make('span')));
    const select = make('select', 'plan');
    options(select, 4);
    // Removing the run shifts the select by 32 px, as the page's reflow did.
    geo.set(select, () => [1697.1 + (table.isConnected ? 0 : 32), 32, 100]);
    document.body.append(vis, table, wrap, select);
    const handler = vi.fn();
    select.addEventListener('click', handler);
    const html = document.body.innerHTML;
    const order = Array.from(document.body.children);
    const seen = during(() => [vis, select, wrap, table].map((n) => n.isConnected));

    expect(await renderFrame(window, host())).toEqual({ source: canvas, width: 1280, height: 720 });
    expect(seen).toEqual([[true, false, false, false]]);
    expect(document.body.innerHTML).toBe(html);
    expect(Array.from(document.body.children)).toEqual(order);
    select.click();
    expect(handler).toHaveBeenCalledTimes(1);
    await renderFrame(window, host());
    expect(seen[1]).toEqual(seen[0]);
    expect(document.body.innerHTML).toBe(html);
  });

  it('keeps visible controls whole without false retention from their descendants', async () => {
    const boxless = make('div');
    boxless.append(at(make('span', 'deep'), 10));
    const shown = at(make('select'), 50);
    options(shown, 3);
    (shown as HTMLSelectElement).selectedIndex = 2;
    const hidden = at(make('select'), 1200);
    options(hidden, 3);
    document.body.append(boxless, shown, hidden);
    const count = shown.querySelectorAll('*').length;
    const seen = during(() => [
      !!document.getElementById('deep'),
      shown.querySelectorAll('*').length,
      (shown as HTMLSelectElement).selectedIndex,
      hidden.isConnected,
    ]);
    await renderFrame(window, host());
    expect(seen).toEqual([[true, count, 2, false]]);

    // A control's subtree is counted: a thousand options exceed the budget visible or not.
    const big = (top: number): HTMLElement => {
      const select = at(make('select'), top);
      for (let i = 0; i < 1001; i++) select.append(origin(make('option')));
      return select;
    };
    document.body.replaceChildren(big(20));
    expect(overBudget(window, host())).toBe(true);
    document.body.replaceChildren(big(1500));
    expect(overBudget(window, host())).toBe(false);
  });

  it('ignores movement confined to offscreen retained elements', async () => {
    const ancestor = make('div');
    const run = Array.from({ length: 3 }, (_, i) => at(make('div'), -100 - 40 * i));
    const child = at(make('div'), 10);
    ancestor.append(child);
    document.body.append(ancestor, ...run);
    // Only the offscreen ancestor moves once the run is gone.
    geo.set(ancestor, () => [-500 + (run[0]!.isConnected ? 0 : 32), 100, 100]);
    const html = document.body.innerHTML;
    const seen = during(() => [run.some((n) => n.isConnected), child.getBoundingClientRect().top]);
    expect(await renderFrame(window, host())).toEqual({ source: canvas, width: 1280, height: 720 });
    expect(seen).toEqual([[false, 10]]);
    expect(document.body.innerHTML).toBe(html);
    expect(ancestor.firstElementChild).toBe(child);
  });
});
