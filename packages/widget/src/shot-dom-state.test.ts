// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { renderFrame } from './shot-dom';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));

const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
const geo = new WeakMap<Element, number[]>();
const at = <T extends Element>(el: T, top: number, h = 32): T => (geo.set(el, [top, h]), el);
const make = (html: string): HTMLElement => {
  const t = document.createElement('div');
  t.innerHTML = html;
  return t.firstElementChild as HTMLElement;
};
const filterOf = (): ((n: Node) => boolean) =>
  (vi.mocked(toCanvas).mock.calls[0]![1] as { filter: (n: Node) => boolean }).filter;

beforeEach(() => {
  document.body.replaceChildren();
  vi.mocked(toCanvas).mockReset();
  vi.mocked(toCanvas).mockResolvedValue(canvas);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const [top = 0, height = 0] = geo.get(this) ?? [];
    return { top, bottom: top + height, left: 0, right: 100, width: 100, height } as DOMRect;
  });
});
afterEach(() => vi.restoreAllMocks());

describe('shot-dom state', () => {
  it('hides a run that holds state in place and drops it from the clone', async () => {
    const host = make('<div id="host"></div>');
    const row = at(make('<div id="row"></div>'), 10);
    const plain = at(make('<div></div>'), 1500);
    const frame = at(make('<iframe style="width:300px"></iframe>'), 1600);
    const wrap = at(make('<div><x-card></x-card></div>'), 1700);
    document.body.append(host, row, plain, frame, wrap);
    const html = document.body.innerHTML;
    const children = Array.from(document.body.children);
    const seen: unknown[] = [];
    vi.mocked(toCanvas).mockImplementation(async (_n, o) => {
      const f = (o as { filter: (n: Node) => boolean }).filter;
      const run = [plain, frame, wrap];
      seen.push(
        run.map((n) => [n.isConnected, n.style.display]),
        [...run, host, row].map(f),
        Array.from(document.body.children).indexOf(plain),
      );
      return canvas;
    });
    await renderFrame(window, host);
    expect(seen[0]).toEqual([3, 4, 5].map(() => [true, 'none']));
    expect(seen[1]).toEqual([false, false, false, false, true]);
    expect(seen[2]).toBe(4);
    expect(document.body.innerHTML).toBe(html);
    expect(Array.from(document.body.children)).toEqual(children);
    expect(frame.getAttribute('style')).toBe('width:300px');
    expect(plain.hasAttribute('style') || wrap.hasAttribute('style')).toBe(false);
    expect([plain, frame, wrap].map(filterOf())).toEqual([true, true, true]);
  });

  it('still detaches a run that holds no state and restores a hidden run on every exit', async () => {
    const host = make('<div id="host"></div>');
    const row = at(make('<div id="row"></div>'), 10);
    const frame = at(make('<iframe></iframe>'), 1500);
    const sep = at(make('<div id="sep"></div>'), 20);
    const a = at(make('<div></div>'), 2000);
    const b = at(make('<div></div>'), 2100);
    document.body.append(host, row, frame, sep, a, b);
    const html = document.body.innerHTML;
    let detached = false;
    let after: string[] = [];
    vi.mocked(toCanvas).mockImplementation(async () => {
      detached = !a.isConnected && !b.isConnected;
      const kids = Array.from(document.body.children) as HTMLElement[];
      after = kids.slice(kids.indexOf(sep) + 1).map((s) => `${s.style.display} ${s.style.height}`);
      return canvas;
    });
    await renderFrame(window, host);
    expect(detached).toBe(true);
    expect(after).toEqual(['block 132px', 'contents 0px']);
    expect(document.body.innerHTML).toBe(html);
    vi.mocked(toCanvas).mockRejectedValue(new Error('render failed'));
    await expect(renderFrame(window, host)).rejects.toThrow('render failed');
    expect(document.body.innerHTML).toBe(html);
    // The row moves once the run is detached, so the movement check throws.
    vi.mocked(toCanvas).mockResolvedValue(canvas);
    row.getBoundingClientRect = () =>
      ({
        top: a.isConnected ? 10 : 300,
        bottom: 400,
        left: 0,
        right: 100,
        width: 100,
        height: 32,
      }) as DOMRect;
    await expect(renderFrame(window, host)).rejects.toThrow();
    expect(document.body.innerHTML).toBe(html);
  });
});
