// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { renderFrame } from './shot-dom';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));

const win = window as unknown as { __passback?: Record<string, unknown> };
const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;

beforeEach(() => {
  vi.mocked(toCanvas).mockReset();
  vi.mocked(toCanvas).mockResolvedValue(canvas);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete win.__passback;
  Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
});

type Box = { top: number; height?: number; width?: number };
const boxes = new WeakMap<Element, Box>();
const place = <T extends Element>(el: T, top: number, height = 32, width = 100): T => (
  boxes.set(el, { top, height, width }),
  el
);
const el = (tag = 'div', id = ''): HTMLElement =>
  Object.assign(document.createElement(tag), { id });
const above = (n: number): Element[] =>
  Array.from({ length: n }, (_, i) => place(el(), -100 - 40 * i));
const visible = (n: number): Element[] => Array.from({ length: n }, (_, i) => place(el(), 40 * i));
const below = (n: number): Element[] =>
  Array.from({ length: n }, (_, i) => place(el(), window.innerHeight + 10 + 40 * i));
const kids = (parent: Element): string[] =>
  Array.from(parent.children).map((c) => c.id || `spacer:${(c as HTMLElement).style.height}`);

beforeEach(() => {
  document.body.replaceChildren();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const { top, height = 32, width = 100 } = boxes.get(this) ?? { top: 0 };
    return { top, bottom: top + height, left: 0, right: width, width, height } as DOMRect;
  });
});

// The page as the renderer sees it while it runs.
const seenDuring = (read: () => unknown): Promise<unknown[]> => {
  const seen: unknown[] = [];
  vi.mocked(toCanvas).mockImplementation(async () => (seen.push(read()), canvas));
  return Promise.resolve(seen);
};

describe('shot-dom', () => {
  it('renders the viewport and leaves the widget host out', async () => {
    const host = document.createElement('div');
    const frame = await renderFrame(window, host);
    expect(frame).toEqual({ source: canvas, width: 1280, height: 720 });
    expect(toCanvas).toHaveBeenCalledExactlyOnceWith(document.documentElement, {
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: 1,
      cacheBust: false,
      style: { margin: '0px 0 0 0px' },
      filter: expect.any(Function),
      includeStyleProperties: expect.any(Array),
      imagePlaceholder: expect.stringMatching(/^data:image\/gif;base64,[A-Za-z0-9+/]+=*$/),
    });
    const { filter } = vi.mocked(toCanvas).mock.calls[0]![1]!;
    expect(filter!(host)).toBe(false);
    expect(filter!(document.body)).toBe(true);
    expect(filter!(document.createElement('div'))).toBe(true);
  });

  it('translates the page by the scroll position so the picture is the visible viewport', async () => {
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 30 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 450 });
    await renderFrame(window, document.createElement('div'));
    expect(vi.mocked(toCanvas).mock.calls[0]![1]!.style).toEqual({ margin: '-450px 0 0 -30px' });
  });

  it('uses the render function registered as __passback.shotRender when there is one', async () => {
    const own = { width: 10, height: 20 } as HTMLCanvasElement;
    const shotRender = vi.fn().mockResolvedValue(own);
    win.__passback = { shotRender };
    const host = document.createElement('div');
    expect(await renderFrame(window, host)).toEqual({ source: own, width: 10, height: 20 });
    expect(shotRender).toHaveBeenCalledExactlyOnceWith(
      document.documentElement,
      expect.objectContaining({ pixelRatio: 1, width: window.innerWidth }),
    );
    expect(toCanvas).not.toHaveBeenCalled();
    win.__passback = { shotRender: 'nope' };
    await renderFrame(window, host);
    expect(toCanvas).toHaveBeenCalledTimes(1);
  });

  it('rejects when the render takes longer than 8 seconds', async () => {
    vi.useFakeTimers();
    vi.mocked(toCanvas).mockReturnValue(new Promise(() => {}));
    let outcome: unknown = 'pending';
    const pending = renderFrame(window, document.createElement('div')).catch((e: unknown) => {
      outcome = e;
    });
    await vi.advanceTimersByTimeAsync(7999);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(outcome).toEqual(new Error('shot render timed out'));
    expect(vi.getTimerCount()).toBe(0);
    vi.mocked(toCanvas).mockResolvedValue(canvas);
    await renderFrame(window, document.createElement('div'));
    expect(vi.getTimerCount()).toBe(0);
    vi.mocked(toCanvas).mockRejectedValue(new Error('boom'));
    await expect(renderFrame(window, document.createElement('div'))).rejects.toThrow('boom');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('filters offscreen content without dropping visible descendants', async () => {
    const host = el('div', 'host');
    const wrap = place(el('div', 'wrap'), -500, 0);
    const inner = place(el('div', 'inner'), 10);
    wrap.append(inner, ...above(2));
    const before = above(3);
    const rows = visible(2);
    rows.forEach((row, i) => (row.id = `row${i}`));
    const handler = vi.fn();
    before[0]!.addEventListener('click', handler);
    host.append(el('b'), el('b'));
    // A visible drawing keeps every shape; an offscreen one stays if a shape reaches into view.
    rows[1]!.innerHTML = '<svg><g><circle></circle><path></path></g></svg>';
    const svg = place(rows[1]!.firstElementChild!, 0, 40);
    const shapes = Array.from(svg.querySelectorAll('*'));
    place(shapes[2]!, window.innerHeight + 50);
    wrap.insertAdjacentHTML('beforeend', '<svg id="draw"><path></path></svg>');
    place(place(wrap.lastElementChild!, -300).firstElementChild!, 10);
    document.body.append(host, wrap, ...before, ...rows, ...below(2));
    const original = Array.from(document.body.children);
    const seen = await seenDuring(() => [
      kids(document.body),
      kids(wrap),
      svg.querySelectorAll('*').length,
    ]);
    await renderFrame(window, host);
    // An odd run keeps one spacer, an even run two, so that :nth-child parity is unchanged.
    expect(seen).toEqual([
      [
        ['host', 'wrap', 'spacer:112px', 'row0', 'row1', 'spacer:72px', 'spacer:0px'],
        ['inner', 'spacer:72px', 'spacer:0px', 'draw'],
        3,
      ],
    ]);
    expect(Array.from(document.body.children)).toEqual(original);
    expect(wrap.children[0]).toBe(inner);
    expect(Array.from(svg.querySelectorAll('*'))).toEqual(shapes);
    before[0]!.dispatchEvent(new Event('click'));
    expect(handler).toHaveBeenCalledOnce();
    const { filter } = vi.mocked(toCanvas).mock.calls[0]![1]!;
    expect(filter!(host)).toBe(false);
    expect(host.children).toHaveLength(2);
  });

  const drawingWithDot = (style: Record<string, string>): HTMLElement => {
    const wrap = place(el('div', 'wrap'), -500, 0);
    wrap.innerHTML = '<svg id="draw"><path></path></svg>';
    place(wrap.firstElementChild!, -300, 100);
    const dot = place(wrap.firstElementChild!.firstElementChild!, -2, 0, 0);
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((target: Element) =>
      target === dot
        ? ({ getPropertyValue: (name: string) => style[name] ?? '' } as CSSStyleDeclaration)
        : real(target),
    );
    document.body.append(wrap);
    return wrap;
  };

  it('keeps an offscreen drawing whose zero-length round-capped stroke reaches into view', async () => {
    drawingWithDot({
      stroke: 'rgb(0, 0, 0)',
      'stroke-width': '10px',
      'stroke-linecap': 'round',
    });
    const seen = await seenDuring(() => kids(document.body));
    await renderFrame(window, el());
    expect(seen).toEqual([['wrap']]);
  });

  it('still prunes an offscreen drawing whose only zero-size part paints nothing', async () => {
    drawingWithDot({
      stroke: 'rgb(0, 0, 0)',
      'stroke-width': '10px',
      'stroke-linecap': 'butt',
    });
    const seen = await seenDuring(() => kids(document.body));
    await renderFrame(window, el());
    expect(seen).toEqual([['spacer:0px']]);
  });

  it('passes a bounded explicit style allowlist', async () => {
    await renderFrame(window, el());
    const names = vi.mocked(toCanvas).mock.calls[0]![1]!.includeStyleProperties as string[];
    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThanOrEqual(80);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'display',
        'font-family',
        'color',
        'background-color',
        'border-color',
        'transform',
        'visibility',
      ]),
    );
  });

  it('rejects above the retained element budget before rendering', async () => {
    const host = el();
    host.append(...Array.from({ length: 50 }, () => el()));
    const shotRender = vi.fn().mockResolvedValue(canvas);
    // html, head and body are retained too: 1000 elements in all.
    document.body.append(host, ...Array.from({ length: 997 }, () => el()));
    await renderFrame(window, host);
    expect(toCanvas).toHaveBeenCalledTimes(1);
    document.body.append(el());
    for (const override of [undefined, shotRender]) {
      win.__passback = override && { shotRender: override };
      await expect(renderFrame(window, host)).rejects.toThrow('over budget');
    }
    expect(toCanvas).toHaveBeenCalledTimes(1);
    expect(shotRender).not.toHaveBeenCalled();
    delete win.__passback;
    // Spacers count: 996 + one spacer + 3 is exactly 1000, one more element is not.
    document.body.replaceChildren(host, ...above(1), ...Array.from({ length: 996 }, () => el()));
    await renderFrame(window, host);
    document.body.append(el());
    await expect(renderFrame(window, host)).rejects.toThrow('over budget');
    expect(document.body.children).toHaveLength(1 + 1 + 997);
    // A table spacer is a row and its cell: html, head, body, table, tbody, tr, td and 2 = 9.
    const cellOf = (top: number): Element => place(el('tr'), top).appendChild(place(el('td'), top));
    const tbody = el('tbody');
    tbody.append(cellOf(-200).parentElement!, cellOf(0).parentElement!);
    const table = place(el('table'), -200, 300);
    table.append(tbody);
    document.body.replaceChildren(host, table, ...Array.from({ length: 991 }, () => el()));
    await renderFrame(window, host);
    document.body.append(el());
    await expect(renderFrame(window, host)).rejects.toThrow('over budget');
    // A frame's elements are cloned twice, with its body and again as its children: 4 + 2 × 498.
    const body = el('body');
    body.append(...Array.from({ length: 498 }, () => el()));
    const frame = Object.defineProperty(el('iframe'), 'contentDocument', { value: { body } });
    document.body.replaceChildren(host, frame);
    await renderFrame(window, host);
    body.append(el());
    await expect(renderFrame(window, host)).rejects.toThrow('over budget');
    // The renderer clones a shadow root's elements, so they are pruned and counted: 4 + 995 + 1.
    const shadow = el('p').attachShadow({ mode: 'open' });
    shadow.append(...above(1), ...Array.from({ length: 995 }, () => el()));
    document.body.replaceChildren(host, shadow.host);
    const seen = await seenDuring(() => kids(shadow as unknown as Element)[0]);
    await renderFrame(window, host);
    shadow.append(el());
    await expect(renderFrame(window, host)).rejects.toThrow('over budget');
    expect(seen).toEqual(['spacer:32px']);
    expect(toCanvas).toHaveBeenCalledTimes(5);
  });

  it('restores temporary capture changes on every render exit', async () => {
    const host = el();
    const cell = el('td');
    cell.setAttribute('style', 'color: red');
    const row = place(el('tr'), 0);
    row.append(place(cell, 0));
    const tbody = el('tbody');
    const gone = above(2);
    tbody.append(...gone, row);
    const table = place(el('table'), 0, 100);
    table.append(tbody);
    document.body.append(host, table, ...below(3));
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 40 });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const html = () => document.documentElement.outerHTML;
    const original = html();
    const pruned = vi.fn(() => {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
      expect(html()).not.toBe(original);
    });
    const fail = (message: string): never => {
      throw new Error(message);
    };
    // Success, a synchronous throw and an asynchronous rejection.
    const exits = [async () => canvas, () => fail('sync'), async () => fail('async')];
    for (const run of exits) {
      vi.mocked(toCanvas).mockImplementation((async () => (pruned(), run())) as never);
      await renderFrame(window, host).catch(() => {});
      expect(html()).toBe(original);
      expect(tbody.children[2]).toBe(row);
      expect(cell.getAttribute('style')).toBe('color: red');
      expect(scrollTo).toHaveBeenLastCalledWith(0, 40);
    }
    vi.useFakeTimers();
    let settle: (c: HTMLCanvasElement) => void = () => {};
    vi.mocked(toCanvas).mockImplementation(() => new Promise((resolve) => (settle = resolve)));
    const late = renderFrame(window, host).catch((e: unknown) => e);
    expect(html()).not.toBe(original);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await late).toEqual(new Error('shot render timed out'));
    expect(html()).toBe(original);
    const calls = scrollTo.mock.calls.length;
    settle(canvas);
    await vi.advanceTimersByTimeAsync(0);
    expect(html()).toBe(original);
    expect(scrollTo).toHaveBeenCalledTimes(calls);
    expect(toCanvas).toHaveBeenCalledTimes(4);
  });

  it('restores the page and rejects when pruning would move visible content', async () => {
    const host = el();
    const rows = visible(2);
    const gone = above(2);
    document.body.append(host, ...gone, ...rows);
    // The first row moves once the offscreen ones are gone.
    const rect = rows[0]!.getBoundingClientRect();
    const moving = () => ({ ...rect, top: gone[0]!.isConnected ? 0 : 50 });
    vi.spyOn(rows[0]!, 'getBoundingClientRect').mockImplementation(moving);
    await expect(renderFrame(window, host)).rejects.toThrow('moved the layout');
    expect(toCanvas).not.toHaveBeenCalled();
    expect(Array.from(document.body.children)).toEqual([host, ...gone, ...rows]);
  });
});
