// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { renderFrame } from './shot-dom';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));

const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
// happy-dom does no layout: a container stacks its children's boxes with its gap between them;
// a display: contents child has no box, a spacer is as high as its style, a td is its row.
const layouts = new Map<Element, { top: number; gap: number }>();
const natural = new Map<Element, number>();
const shown = (els: Element[]): Element[] =>
  els.filter((c) => (c as HTMLElement).style.display !== 'contents');
const heightOf = (el: Element): number =>
  Number.parseFloat((el as HTMLElement).style.height) || (natural.get(el) ?? 0);
const boxOf = (el: Element): [number, number] => {
  const own = layouts.get(el);
  if (own) {
    const items = shown(Array.from(el.children));
    const sum = items.reduce((n, c) => n + heightOf(c), 0);
    return [own.top, sum + own.gap * Math.max(0, items.length - 1)];
  }
  const parent = el.parentElement ?? el;
  if (el.localName === 'td' || layouts.has(el.firstElementChild!)) {
    return boxOf(el.localName === 'td' ? parent : el.firstElementChild!);
  }
  const layout = layouts.get(parent);
  let top = layout?.top ?? 0;
  for (const c of shown(Array.from(parent.children))) {
    if (c === el) return [top, layout ? heightOf(c) : 0];
    top += heightOf(c) + (layout?.gap ?? 0);
  }
  return [0, 0];
};
const rectsOf = (els: Element[]): number[][] => els.map((e) => boxOf(e));
const make = (tag: string, id: string, height = 0): HTMLElement => {
  const el = Object.assign(document.createElement(tag), { id });
  natural.set(el, height);
  return el;
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
    const [top, height] = boxOf(this);
    return { top, bottom: top + height, left: 0, right: 100, width: 100, height } as DOMRect;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  layouts.clear();
});

describe('shot-dom spacers inside gaps', () => {
  it('renders even offscreen runs in flex and grid gaps without moving retained rectangles', async () => {
    for (const display of ['display:flex;flex-direction:column', 'display:grid']) {
      document.body.replaceChildren();
      vi.mocked(toCanvas).mockClear();
      const [host, page, list] = [make('div', 'host'), make('main', 'page'), make('div', 'list')];
      list.style.cssText = `${display};gap:16px`;
      layouts.set(list, { top: -460, gap: 16 });
      // Four offscreen blocks, then two visible rows.
      const gone = [0, 1, 2, 3].map((i) => make('div', `gone${i}`, 100));
      const rows = [0, 1].map((i) => make('div', `row${i}`, 32));
      list.append(...gone, ...rows);
      page.append(list);
      document.body.append(host, page);
      const original = Array.from(list.children);
      const retained = [page, list, ...rows];
      const before = rectsOf(retained);
      expect(before[2]).toEqual([4, 32]);
      const seen: unknown[] = [];
      vi.mocked(toCanvas).mockImplementation(async () => {
        const kids = Array.from(list.children) as HTMLElement[];
        const spacers = kids
          .slice(0, 2)
          .map((s) => `${s.localName} ${s.style.display} ${s.style.height}`);
        seen.push([...spacers, ...rows.map((r) => `${r.id} ${kids.indexOf(r) % 2}`)]);
        rectsOf(retained).forEach((r, i) => {
          expect(Math.abs(r[0]! - before[i]![0]!)).toBeLessThanOrEqual(1);
          expect(Math.abs(r[1]! - before[i]![1]!)).toBeLessThanOrEqual(1);
        });
        return canvas;
      });
      const frame = await renderFrame(window, host);
      expect(frame).toEqual({ source: canvas, width: 1280, height: 720 });
      expect(toCanvas).toHaveBeenCalledOnce();
      // The run had four children, so the rows keep their :nth-child parity.
      expect(seen).toEqual([['div block 448px', 'div contents 0px', 'row0 0', 'row1 1']]);
      expect(Array.from(list.children)).toEqual(original);
      expect(rectsOf(retained)).toEqual(before);
    }
  });

  it('keeps table parity spacers display contents through height adjustment', async () => {
    const [host, table, body] = [make('div', 'host'), make('table', 'table'), make('tbody', 'b')];
    layouts.set(body, { top: -410, gap: 0 });
    const row = (id: string, height: number): HTMLElement => {
      const td = make('td', '', height);
      td.setAttribute('style', 'color:red');
      const tr = make('tr', id, height);
      tr.append(td);
      return tr;
    };
    body.append(...[0, 1, 2, 3].map((i) => row(`gone${i}`, 100)), row('row0', 32), row('row1', 32));
    table.append(body);
    document.body.append(host, table);
    const original = Array.from(body.children);
    const html = body.innerHTML;
    const seen: unknown[] = [];
    vi.mocked(toCanvas).mockImplementation(async () => {
      const kids = Array.from(body.children) as HTMLElement[];
      seen.push(
        kids.map(
          (s) =>
            `${s.localName}>${s.firstElementChild?.localName} ${s.style.display} ${s.style.height}`,
        ),
      );
      return canvas;
    });
    await renderFrame(window, host);
    expect(toCanvas).toHaveBeenCalledOnce();
    expect(seen).toEqual([['tr>td  400px', 'tr>td contents 0px', 'tr>td  ', 'tr>td  ']]);
    expect(Array.from(body.children)).toEqual(original);
    expect(body.innerHTML).toBe(html);
  });
});
