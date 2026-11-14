// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { renderFrame } from './shot-dom';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));

const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
type Box = [top: number, left: number, width: number, height: number];
const geo = new WeakMap<Element, () => Box>();
const make = (tag: string, id: string, box: () => Box): HTMLElement => {
  const el = Object.assign(document.createElement(tag), { id });
  const rect = () => Element.prototype.getBoundingClientRect.call(el);
  Object.defineProperty(el, 'getBoundingClientRect', { value: rect });
  geo.set(el, box);
  return el;
};

beforeEach(async () => {
  const dom = (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM;
  dom.setViewport({ width: 1280, height: 900 });
  document.head.innerHTML = '<style>*{animation:none!important;transition:none!important}</style>';
  await document.fonts?.ready;
  vi.mocked(toCanvas).mockReset().mockResolvedValue(canvas);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const [top, left, width, height] = geo.get(this)?.() ?? [0, 0, 0, 0];
    return { top, left, width, height, bottom: top + height, right: left + width } as DOMRect;
  });
});
afterEach(() => vi.restoreAllMocks());

// A retained ancestor whose box switches from `before` to `after` only while the offscreen run is detached.
function mount(before: Box, after: Box) {
  document.body.replaceChildren();
  const run = make('div', 'run', () => [2000, 0, 100, 40]);
  const root = make('div', 'lab-heavy-root', () => (run.isConnected ? before : after));
  const child = make('p', 'child', () => [100, 8, 50, 20]);
  root.append(child);
  document.body.append(root, run);
  const seen: boolean[] = [];
  vi.mocked(toCanvas)
    .mockClear()
    .mockImplementation(async () => (seen.push(run.isConnected), canvas));
  return { root, run, child, seen, html: document.body.innerHTML, order: [root, run] };
}
const moved = 'shot pruning moved the layout';
const capture = () => renderFrame(window, document.createElement('div'));

describe('shot-dom viewport clipping', () => {
  it('ignores retained ancestor height drift below the viewport', async () => {
    const m = mount([79.9, 8, 1264, 1979.2], [79.9, 8, 1264, 1995.2]);
    expect(await capture()).toEqual({ source: canvas, width: 1280, height: 720 });
    expect(m.seen).toEqual([false]);
    expect(document.body.innerHTML).toBe(m.html);
    expect(Array.from(document.body.children)).toEqual(m.order);
    expect(m.root.firstElementChild).toBe(m.child);
    expect(await capture()).toEqual({ source: canvas, width: 1280, height: 720 });
    expect(m.seen).toEqual([false, false]);
    expect(document.body.innerHTML).toBe(m.html);
  });

  it('ignores rectangle changes confined beyond each viewport edge', async () => {
    // Each row is the ancestor box before, then after: top, left, width, height.
    const cases: number[][] = [
      [-500, 8, 400, 450, -520, 8, 400, 470], // top
      [20, -300, 350, 400, 20, -320, 370, 400], // left
      [20, 1000, 500, 400, 20, 1000, 520, 400], // right
      [20, 8, 400, 3000, 20, 8, 400, 3500], // bottom
      [-300, -300, 2000, 2500, -350, -310, 2100, 2600], // spanning
    ];
    for (const c of cases) {
      const m = mount(c.slice(0, 4) as Box, c.slice(4) as Box);
      await capture();
      expect(m.seen).toEqual([false]);
      expect(document.body.innerHTML).toBe(m.html);
    }
  });

  it('rejects visible clipped rectangle changes and restores the page', async () => {
    const cases: number[][] = [
      [-100, 8, 400, 500, -120, 8, 400, 500], // top
      [20, -100, 500, 400, 20, -120, 500, 400], // left
      [20, 8, 400, 400, 20, 8, 450, 400], // width
      [20, 8, 400, 400, 20, 8, 400, 450], // height
      [950, 8, 400, 400, 850, 8, 400, 400], // entering from below
      [850, 8, 400, 400, 950, 8, 400, 400], // leaving below
      [-500, 8, 400, 400, -300, 8, 400, 400], // entering from above
    ];
    for (const c of cases) {
      const m = mount(c.slice(0, 4) as Box, c.slice(4) as Box);
      await expect(capture()).rejects.toThrow(moved);
      expect(toCanvas).not.toHaveBeenCalled();
      expect(m.run.isConnected).toBe(true);
      expect(document.body.innerHTML).toBe(m.html);
      expect(Array.from(document.body.children)).toEqual(m.order);
      expect(m.root.firstElementChild).toBe(m.child);
    }
  });

  it('keeps the one pixel tolerance for clipped rectangles', async () => {
    const base: Box = [20, 8, 400, 400];
    for (let i = 0; i < 4; i++) {
      for (const delta of [1, 1.5]) {
        const after = base.map((v, j) => (j === i ? v + delta : v)) as Box;
        // Moving top or left also moves the far edge; hold it so one component differs.
        if (i < 2) after[3 - i] = base[3 - i]! - delta;
        mount(base, after);
        if (delta === 1) await expect(capture()).resolves.toBeDefined();
        else await expect(capture()).rejects.toThrow(moved);
      }
    }
  });
});
