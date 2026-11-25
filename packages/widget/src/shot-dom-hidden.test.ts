// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { renderFrame } from './shot-dom';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));

const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
const geo = new WeakMap<Element, () => number[]>();
const make = (tag: string, top = 0, h = 0, w = 0): HTMLElement => {
  const el = document.createElement(tag);
  geo.set(el, () => [top, h, w]);
  return el;
};
const gone = (tag = 'a'): HTMLElement => {
  const el = make(tag);
  el.style.display = 'none';
  return el;
};
const host = (): HTMLElement => Object.assign(make('div'), { id: 'host' });
const during = <T>(read: () => T): T[] => {
  const seen: T[] = [];
  vi.mocked(toCanvas).mockImplementation(async () => (seen.push(read()), canvas));
  return seen;
};

beforeEach(() => {
  const dom = (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM;
  dom.setViewport({ width: 1280, height: 900 });
  document.body.replaceChildren();
  vi.mocked(toCanvas).mockReset();
  vi.mocked(toCanvas).mockResolvedValue(canvas);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const [top = 0, height = 0, width = 0, left = 0] = geo.get(this)?.() ?? [];
    return { top, bottom: top + height, left, right: left + width, width, height } as DOMRect;
  });
});
afterEach(() => vi.restoreAllMocks());

describe('shot-dom hidden nodes', () => {
  it('replaces a hidden run between visible items with a spacer that has no box', async () => {
    const nav = make('nav', 10, 32, 400);
    nav.style.cssText = 'display:flex;gap:16px';
    const [a, b, c] = [make('a', 10, 32, 50), gone(), make('a', 10, 32, 50)];
    nav.append(a, b, c);
    const kids = (): HTMLElement[] => Array.from(nav.children) as HTMLElement[];
    const between = (): HTMLElement[] => kids().slice(1, kids().indexOf(c));
    const shown = (): number => between().filter((n) => n.style.display !== 'none').length;
    geo.set(c, () => [10, 32, 50, 66 + 16 * shown()]);
    document.body.append(nav);
    const html = document.body.innerHTML;
    const seen = during(() => kids().map((n) => [n === a, n === c, n.localName, n.style.cssText]));
    await renderFrame(window, host());
    expect(toCanvas).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([
      [
        [true, false, 'a', ''],
        [false, false, 'div', 'display: none;'],
        [false, true, 'a', ''],
      ],
    ]);
    expect(document.body.innerHTML).toBe(html);
    expect(Array.from(nav.children)).toEqual([a, b, c]);
  });

  it('keeps hidden nodes out of a run height and never corrects a boxless spacer', async () => {
    const box = make('div', 10, 32, 100);
    const tail = make('div', 50, 32, 100);
    const pair = [gone('p'), gone('p')];
    const mixed = [gone('p'), make('p', -900, 600, 100)];
    const after = make('section', 100, 32, 100);
    geo.set(tail, () => [50 + (pair[0]!.isConnected ? 0 : 0.5), 32, 100]);
    document.body.append(box, ...pair, tail, ...mixed, after);
    const seen = during(() => [
      ...Array.from(document.body.children).map((n) => (n as HTMLElement).style.cssText),
      tail.getBoundingClientRect().top,
    ]);
    await renderFrame(window, host());
    expect(seen[0]!.at(-1)).toBe(50.5);
    expect(seen[0]![1]).toBe('display: none;');
    expect(seen[0]![2]).toBe('display: none;');
    expect(seen[0]![4]).toContain('600px');
    expect(seen[0]!.filter((c) => c === 'display: none;')).toHaveLength(2);
  });
});
