// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { renderFrame } from './shot-dom';
vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));

const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
// sits at its original top, minus the run's footprint, plus the spacers before it that have a box.
const boxes = new Map<Element, [number, number]>();
let footprint = 0;
let run: Element;
const rect = (top: number, height: number): DOMRect =>
  ({ top, bottom: top + height, left: 0, right: 100, width: 100, height }) as DOMRect;
const taken = (el: Element): number =>
  Array.from(el.parentElement!.children)
    .slice(0, Array.from(el.parentElement!.children).indexOf(el))
    .map((p) => p as HTMLElement)
    .filter((p) => p.style.height && !['contents', 'none'].includes(p.style.display))
    .reduce((n, p) => n + Number.parseFloat(p.style.height), 0);
const make = (tag: string, top: number, height: number): HTMLElement => {
  const el = document.createElement(tag);
  boxes.set(el, [top, height]);
  return el;
};

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
  Object.defineProperty(document, 'fonts', {
    value: { ready: Promise.resolve() },
    configurable: true,
  });
  document.body.replaceChildren();
  vi.mocked(toCanvas).mockReset();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const own = boxes.get(this) ?? boxes.get(this.parentElement!);
    if (!own) return rect(-5000, 10000);
    const detached = !run.isConnected;
    const shift = detached && boxes.has(this) && own[0] >= 0 ? taken(this) - footprint : 0;
    return rect(own[0] + shift, own[1]);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  boxes.clear();
});

const setup = (tag: string, parent: string, tops: number[], extent: number, foot: number) => {
  const host = document.createElement('div');
  const box = document.createElement(parent);
  const gone = tops.map((t) => make(tag, t, 100));
  const rows = [0, 1].map((i) => make(tag, i * 32, 32));
  if (tag === 'tr') for (const r of [...gone, ...rows]) r.append(document.createElement('td'));
  box.append(...gone, ...rows);
  document.body.append(host, box);
  run = gone[0]!;
  footprint = foot;

  return { host, box, rows };
};

describe('shot-dom correction of an even run', () => {
  it('settles an even run on its first spacer and leaves the parity spacer alone', async () => {
    for (const [tag, parent, tops, extent, foot] of [
      ['div', 'main', [-900, -180], 820, 860],
      ['tr', 'tbody', [-520, -420, -320, -220], 400, 408],
    ] as const) {
      document.body.replaceChildren();
      vi.mocked(toCanvas).mockReset();
      const { host, box, rows } = setup(tag, parent, [...tops], extent, foot);
      const original = Array.from(box.children);
      const html = box.innerHTML;
      const before = rows.map((r) => r.getBoundingClientRect().top);
      const seen: unknown[] = [];
      vi.mocked(toCanvas).mockImplementation(async () => {
        const kids = Array.from(box.children) as HTMLElement[];
        seen.push(
          kids
            .slice(0, 2)
            .map(
              (s) =>
                `${s.localName}${tag === 'tr' ? '>td' : ''} ${s.style.display} ${s.style.height}`,
            ),
        );
        expect(rows.map((r) => r.getBoundingClientRect().top)).toEqual(before);
        return canvas;
      });
      await renderFrame(window, host);
      expect(toCanvas).toHaveBeenCalledOnce();
      const height = `${foot}px`;
      expect(seen).toEqual([
        tag === 'tr'
          ? [`tr>td  ${height}`, 'tr>td contents 0px']
          : [`div block ${height}`, 'div contents 0px'],
      ]);
      expect(Array.from(box.children)).toEqual(original);
      expect(box.innerHTML).toBe(html);
    }
  });
});
