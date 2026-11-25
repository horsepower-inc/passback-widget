// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { renderFrame } from './shot-dom';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));

const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
// happy-dom does no layout. An element's top is its original top minus, for each run that
// precedes it in its own flow, the run's footprint less the height its spacer has now.
const orig = new Map<Element, [number, number]>();
const runs: { parent: Element; before: Element; footprint: number }[] = [];
const spacerOf = (before: Element): HTMLElement | null => {
  const s = before.previousElementSibling as HTMLElement | null;
  return s && !orig.has(s) ? s : null;
};
const el = (tag: string, id: string, top: number, height: number): HTMLElement => {
  const e = Object.assign(document.createElement(tag), { id });
  orig.set(e, [top, height]);
  return e;
};
const run = (parent: Element, before: Element, footprint: number): void => {
  runs.push({ parent, before, footprint });
};

beforeEach(async () => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
  Object.defineProperty(document, 'fonts', {
    value: { ready: Promise.resolve() },
    configurable: true,
  });
  document.head.innerHTML = '<style>*{animation:none!important;transition:none!important}</style>';
  await document.fonts.ready;
  document.body.replaceChildren();
  vi.mocked(toCanvas).mockReset();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const [start, height] = orig.get(this) ?? [0, 720];
    let top = start;
    if (orig.has(this))
      for (const { parent, before, footprint } of runs) {
        const spacer = spacerOf(before);
        if (!spacer || !parent.contains(this) || !(spacer.compareDocumentPosition(this) & 4))
          continue;
        top -= footprint - (Number.parseFloat(spacer.style.height) || 0);
      }
    return { top, bottom: top + height, left: 0, right: 100, width: 100, height } as DOMRect;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  orig.clear();
  runs.length = 0;
});

const tops = (els: Element[]): number[] => els.map((e) => e.getBoundingClientRect().top);
describe('shot-dom settling corrections run by run', () => {
  it('settles an outer run before the run nested after it', async () => {
    const [host, main] = [el('div', 'host', 0, 0), el('main', 'main', -490, 600)];
    const [head, inner] = [el('header', 'head', -700, 200), el('section', 'inner', -300, 100)];
    const rows = [el('p', 'r0', 10, 32), el('p', 'r1', 42, 32)];
    main.append(inner, ...rows);
    // A shadow tree's run lands between the two in runsOf order and must not pin the outer one.
    const shade = el('div', 'shade', 80, 40);
    shade.attachShadow({ mode: 'open' }).append(el('p', 'gone', -900, 30), el('p', 'lit', 80, 40));
    document.body.append(host, head, main, shade);
    run(document.body, main, 210);
    run(main, rows[0]!, 140);
    const before = tops(rows);
    const seen: unknown[] = [];
    vi.mocked(toCanvas).mockImplementation(async () => {
      seen.push([
        spacerOf(main)!.style.height,
        spacerOf(rows[0]!)!.style.height,
        ...tops(rows).map((t, i) => t - before[i]!),
      ]);
      return canvas;
    });
    const html = document.body.innerHTML;
    await renderFrame(window, host);
    expect(toCanvas).toHaveBeenCalledOnce();
    expect(seen).toEqual([['210px', '140px', 0, 0]]);
    expect(document.body.innerHTML).toBe(html);
  });

  it('settles two side by side columns each on its own anchor', async () => {
    const [host, wrap] = [el('div', 'host', 0, 0), el('div', 'wrap', -300, 400)];
    const cols = ['a', 'b'].map((id) => el('div', id, -300, 400));
    const rows = cols.map((c, i) => {
      const gone = el('p', `gone${i}`, -300, 100);
      const pair = [el('p', `r${i}0`, 10, 32), el('p', `r${i}1`, 42, 32)];
      c.append(gone, ...pair);
      run(c, pair[0]!, 132);
      return pair;
    });
    wrap.append(...cols);
    document.body.append(host, wrap);
    const seen: unknown[] = [];
    vi.mocked(toCanvas).mockImplementation(async () => {
      seen.push(rows.map((pair) => spacerOf(pair[0]!)!.style.height));
      expect(tops(rows.flat())).toEqual([10, 42, 10, 42]);
      return canvas;
    });
    const html = document.body.innerHTML;
    await renderFrame(window, host);
    expect(toCanvas).toHaveBeenCalledOnce();
    expect(seen).toEqual([['132px', '132px']]);
    expect(document.body.innerHTML).toBe(html);
  });
});
