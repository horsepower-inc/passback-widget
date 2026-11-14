// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { overBudget, renderFrame } from './shot-dom';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));

const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
type Box = [top: number, left: number, width: number, height: number];
type Seen = [Element[], boolean[], boolean[], string[][]]; // children, cards and kids on, inside
const geo = new WeakMap<Element, Box>();
const make = (tag: string, box: Box, style = ''): HTMLElement => {
  const el = document.createElement(tag);
  el.setAttribute('style', style);
  geo.set(el, box);
  return el;
};

beforeEach(() => {
  const dom = (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM;
  dom.setViewport({ width: 1280, height: 900 });
  document.head.innerHTML = '';
  vi.mocked(toCanvas).mockReset().mockResolvedValue(canvas);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const [top, left, width, height] = geo.get(this) ?? [0, 0, 0, 0];
    return { top, left, width, height, bottom: top + height, right: left + width } as DOMRect;
  });
});
afterEach(() => vi.restoreAllMocks());

// Six cards, each with one child: three above the viewport, three in it. `columns` puts them in
// two rows of three; otherwise they stack in one column.
function mount(style: string, columns: boolean) {
  document.body.replaceChildren();
  const box = (i: number): Box =>
    columns
      ? [i < 3 ? -400 : 100, (i % 3) * 100, 100, 200]
      : [i < 3 ? -500 + i * 100 : i * 100 - 200, 0, 100, 100];
  const root = make('div', [-500, 0, 300, 900], style);
  const cards = Array.from({ length: 6 }, (_, i) => make('div', box(i)));
  const kids = cards.map((card, i) => {
    const kid = make('p', box(i));
    card.append(kid);
    return kid;
  });
  root.append(...cards);
  document.body.append(root);
  const seen: unknown[] = [];
  vi.mocked(toCanvas).mockImplementation(async () => {
    seen.push([
      Array.from(root.children),
      cards.map((c) => c.isConnected),
      kids.map((k) => k.isConnected),
      cards.map((c, i) => Array.from(c.children).map((n) => (n === kids[i] ? 'kid' : n.localName))),
    ]);
    return canvas;
  });
  return { root, cards, kids, seen, html: document.body.innerHTML };
}
const capture = () => renderFrame(window, document.createElement('div'));

describe('shot-dom columns', () => {
  it('keeps every card of a grid in columns and prunes inside the offscreen ones', async () => {
    for (const style of ['display:grid', 'display:flex;flex-wrap:wrap']) {
      const m = mount(style, true);
      await capture();
      expect(toCanvas).toHaveBeenCalled();
      const [children, cardsOn, kidsOn, inside] = m.seen[0] as Seen;
      expect(children).toEqual(m.cards);
      expect(cardsOn.every(Boolean)).toBe(true);
      expect(kidsOn).toEqual([false, false, false, true, true, true]);
      // Each offscreen card's child is replaced by exactly one spacer; a visible card keeps its own.
      expect(inside).toEqual([['div'], ['div'], ['div'], ['kid'], ['kid'], ['kid']]);
      expect(document.body.innerHTML).toBe(m.html);
      vi.mocked(toCanvas).mockClear();
    }
  });

  it('still replaces a run with a spacer where the children stack or the parent is a block', async () => {
    const block = mount('', true);
    await capture();
    const first = block.seen[0] as Seen;
    expect(first[0]).toHaveLength(4);
    expect(first[1].slice(0, 3)).toEqual([false, false, false]);
    expect(document.body.innerHTML).toBe(block.html);

    const stack = mount('display:grid', false);
    await capture();
    const [children, cardsOn] = stack.seen[0] as Seen;
    expect(children).toHaveLength(4);
    expect(cardsOn.slice(0, 3)).toEqual([false, false, false]);

    document.body.replaceChildren();
    const root = make('div', [-500, 0, 300, 900], 'display:grid');
    const many = Array.from({ length: 1000 }, (_, i) => make('div', [-5000, i * 100, 100, 200]));
    root.append(...many, make('div', [100, 0, 100, 200]));
    document.body.append(root);
    expect(overBudget(window, document.createElement('div'))).toBe(true);
  });
});
