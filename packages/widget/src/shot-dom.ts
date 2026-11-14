import { toCanvas } from 'html-to-image';
import type { Frame } from './shot-paint';
import { hidden, hide, holdsState, inColumns } from './shot-dom-keep';

const RENDER_TIMEOUT_MS = 8000;
const MAX_ELEMENTS = 1000;
// One grey pixel stands in for an image that cannot be fetched.
const PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAMLCwgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';
// Copied for each retained element in place of every computed property; at most 80 names.
const STYLE_PROPERTIES = [
  ...['display', 'position', 'top', 'right', 'bottom', 'left', 'float', 'clear', 'z-index'],
  ...['box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'],
  ...['margin', 'padding', 'overflow', 'flex', 'flex-direction', 'flex-wrap', 'order', 'gap'],
  ...['justify-content', 'align-items', 'align-self', 'align-content', 'grid-auto-flow'],
  ...['grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row'],
  ...['border-collapse', 'border-spacing', 'table-layout', 'vertical-align'],
  ...['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing'],
  ...['word-spacing', 'text-align', 'text-indent', 'text-transform', 'text-decoration-line'],
  ...['white-space', 'word-break', 'overflow-wrap', 'text-overflow', 'direction'],
  ...['color', 'opacity', 'background-color', 'background-image', 'background-size'],
  ...['background-position', 'background-repeat', 'border-width', 'border-style'],
  ...['border-color', 'border-radius', 'box-shadow', 'transform', 'transform-origin'],
  ...['visibility', 'object-fit', 'content', 'fill', 'stroke', 'list-style-type'],
];

type Render = (node: HTMLElement, options: object) => Promise<HTMLCanvasElement>;
type Config = { shotEngine?: unknown; shotRender?: unknown };
type Run = { parent: Element; nodes: Element[]; state: boolean };

const configOf = (win: Window): Config | undefined =>
  (win as unknown as { __passback?: Config }).__passback;

// Inside a drawing an empty box is a part that is never painted, such as a title or defs.
// A round or square stroke cap still paints a dot of the stroke width, so the box grows by half of it.
function inView(win: Window, el: Element, r: DOMRect): boolean {
  let grow = 0;
  if ((el as SVGElement).ownerSVGElement && !r.width && !r.height) {
    const style = win.getComputedStyle(el);
    const width = parseFloat(style.getPropertyValue('stroke-width'));
    const cap = style.getPropertyValue('stroke-linecap');
    if (
      style.getPropertyValue('stroke') === 'none' ||
      !style.getPropertyValue('stroke') ||
      !(width > 0) ||
      (cap !== 'round' && cap !== 'square')
    )
      return false;
    grow = width / 2;
  } else if (!(el as SVGElement).ownerSVGElement && (r.width <= 0 || r.height <= 0)) return false;
  return (
    r.right + grow >= 0 &&
    r.left - grow <= win.innerWidth &&
    r.bottom + grow >= 0 &&
    r.top - grow <= win.innerHeight
  );
}

// The children html-to-image clones: a slot's assigned elements, the body of a same-origin frame,
// or the shadow root's children in place of the light ones.
function rendered(el: Element): Element[] {
  if (el.localName === 'slot') return (el as HTMLSlotElement).assignedElements();
  const body = el.localName === 'iframe' && (el as HTMLIFrameElement).contentDocument?.body;
  return Array.from((body || el.shadowRoot || el).children);
}

// The elements that must stay for the viewport picture: what intersects it, and every ancestor
// of that. A descendant is visited before its ancestor is judged, so a zero-sized wrapper around
// visible content stays. The widget host and what is inside it are never part of the picture.
// Also returns the number of elements the renderer will clone: a frame's descendants twice over.
function retained(win: Window, host: HTMLElement): [Map<Element, DOMRect>, number] {
  const keep = new Map<Element, DOMRect>();
  let copies = 0;
  const visit = (el: Element): boolean => {
    if (el === host) return true;
    let inside = false;
    // Head and its kin have no box yet style the page: they stay, whole, wherever they report.
    if (/^(head|script|style|link|meta|template|noscript|title|base)$/.test(el.localName)) {
      keep.set(el, el.getBoundingClientRect());
      whole(el, 1);
      return true;
    }
    const frame = el.localName === 'iframe';
    // A drawing's shapes are visited too: with overflow visible one can reach into the viewport.
    const leaf = /^(iframe|input|textarea|select)$/.test(el.localName);
    // A control is judged by its own box; its options and the like never make it visible.
    if (!leaf) for (const child of rendered(el)) inside = visit(child) || inside;
    const r = el.getBoundingClientRect();
    if (!inside && !inView(win, el, r)) return false;
    keep.set(el, r);
    // A drawing is kept whole: its shapes are not flow content a spacer could stand in for. So is
    // a frame, whose geometry is its own viewport's.
    if (leaf || el.localName === 'svg') whole(el, frame ? 2 : 1);
    // A row's cells, a slot's elements, a column container's shown children stay: no spacer can.
    const cells = rendered(el).filter((c) => c !== host);
    const kept = /^(tr|slot)$/.test(el.localName) ? cells : inColumns(win, el, cells);
    for (const cell of kept) keep.set(cell, cell.getBoundingClientRect());
    return true;
  };
  // html-to-image clones a frame's body with all its descendants, then appends a second clone of
  // the body's children, so each element inside a frame is rendered `n` times.
  const whole = (el: Element, n: number): void => {
    for (const child of rendered(el)) {
      keep.set(child, child.getBoundingClientRect());
      copies += n - 1;
      whole(child, child.localName === 'iframe' ? 2 * n : n);
    }
  };
  visit(win.document.documentElement);
  return [keep, keep.size + copies];
}

function runsOf(keep: Map<Element, DOMRect>, host: HTMLElement): Run[] {
  const runs: Run[] = [];
  for (const parent of keep.keys()) {
    let nodes: Element[] = [];
    const flush = (): void => {
      if (nodes.length) runs.push({ parent, nodes, state: nodes.some(holdsState) });
      nodes = [];
    };
    for (const child of rendered(parent)) {
      if (child !== host && !keep.has(child)) nodes.push(child);
      else flush();
    }
    flush();
  }
  return runs;
}

const columnsOf = (row: Element): number =>
  Math.max(
    1,
    Array.from((row as HTMLTableRowElement).cells ?? []).reduce((n, c) => n + c.colSpan, 0),
  );

// The parity spacer is boxless (display: contents), so a flex or grid gap is not added twice.
function setHeight(spacer: HTMLElement, height: number, parity = false, none = false): void {
  if (none) return void (spacer.style.cssText = 'display:none');
  const css = `height:${height}px;margin:0;padding:0;border:0;`;
  const cell = spacer.firstElementChild as HTMLElement | null;
  spacer.style.cssText = parity ? `display:contents;${css}` : cell ? css : `display:block;${css}`;
  if (cell) cell.style.cssText = css;
}

// One spacer takes the height of a run. A run of an even length gets a second, empty one, so
// that :nth-child parity (zebra stripes) after the run stays what it was.
function spacersFor(run: Run, keep: Map<Element, DOMRect>): HTMLElement[] {
  const doc = run.parent.ownerDocument;
  const rects = run.nodes.map((n) => keep.get(n) ?? n.getBoundingClientRect());
  const display = (n: Element) => doc.defaultView!.getComputedStyle(n).getPropertyValue('display');
  const shown = rects.filter((r, i) => r.width || r.height || display(run.nodes[i]!) !== 'none');
  const height = Math.max(...shown.map((r) => r.bottom)) - Math.min(...shown.map((r) => r.top));
  const section = /^(tbody|thead|tfoot)$/.test(run.parent.localName);
  return Array.from({ length: run.state || !(run.nodes.length % 2) ? 2 : 1 }, (_, i) => {
    const spacer = doc.createElement(section ? 'tr' : 'div');
    if (section)
      spacer.append(Object.assign(doc.createElement('td'), { colSpan: columnsOf(run.nodes[0]!) }));
    setHeight(spacer, i ? 0 : Math.max(0, height), i > 0, !shown.length);
    return spacer;
  });
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;

// A rectangle cut to the viewport as [top, left, width, height]: only the visible part must hold still.
function clip(win: Window, r: DOMRect): number[] {
  const x = (v: number): number => Math.min(Math.max(v, 0), win.innerWidth);
  const y = (v: number): number => Math.min(Math.max(v, 0), win.innerHeight);
  const [top, bottom, left, right] = [y(r.top), y(r.bottom), x(r.left), x(r.right)];
  return [top, left, Math.max(0, right - left), Math.max(0, bottom - top)];
}

// The pruning plan and its budget: detached spacers only, the page is not changed.
function plan(win: Window, host: HTMLElement) {
  const [keep, size] = retained(win, host);
  const runs = runsOf(keep, host);
  const parts = runs.map((run) => spacersFor(run, keep));
  // Every element a spacer adds counts, the cell inside a table spacer row too.
  const added = parts.flat().reduce((n, s) => n + 1 + s.querySelectorAll('*').length, 0);
  return { keep, runs, parts, over: size + added > MAX_ELEMENTS };
}

// Whether the pruned tree is over the element budget, so that the render would be refused.
export function overBudget(win: Window, host: HTMLElement): boolean {
  return plan(win, host).over;
}

// Sorted within each tree, into its own slots: across trees no order is total (frame, shadow).
function inTreeOrder(parts: HTMLElement[][]): HTMLElement[][] {
  const ordered = parts.slice();
  const roots = parts.map((p) => p[0]!.getRootNode());
  const later = (a: HTMLElement[], b: HTMLElement[]) => a[0]!.compareDocumentPosition(b[0]!) & 2;
  for (const root of new Set(roots)) {
    const slots = roots.flatMap((r, i) => (r === root ? [i] : []));
    const tree = slots.map((i) => parts[i]!).sort((a, b) => (later(a, b) ? 1 : -1));
    slots.forEach((slot, k) => (ordered[slot] = tree[k]!));
  }
  return ordered;
}

// Removes the wholly offscreen runs, leaving one spacer per run, and returns the undo. Throws,
// with the page already restored, when the tree is over budget or the layout moved.
function prune(win: Window, host: HTMLElement): () => void {
  const { keep, runs, parts, over } = plan(win, host);
  if (over) throw new Error('shot tree over budget');
  const { scrollX, scrollY } = win;
  const undo: (() => void)[] = [];
  const restore = (): void => {
    while (undo.length) undo.pop()!();
    if (win.scrollX !== scrollX || win.scrollY !== scrollY) win.scrollTo(scrollX, scrollY);
  };
  try {
    const tables = new Set(runs.map((run) => run.parent.closest('table')));
    for (const [el, r] of keep) {
      if (!/^t[dh]$/.test(el.localName) || !tables.has(el.closest('table'))) continue;
      const style = el.getAttribute('style');
      undo.push(() =>
        style === null ? el.removeAttribute('style') : el.setAttribute('style', style),
      );
      Object.assign((el as HTMLElement).style, { boxSizing: 'border-box', width: `${r.width}px` });
    }
    const starts = new Map<Element, Element>();
    runs.forEach((run, i) => {
      run.nodes[0]!.before(...parts[i]!);
      if (run.state) {
        undo.push(hide(run.nodes, parts[i]!));
        return void starts.set(parts[i]![0]!, run.nodes.at(-1)!);
      }
      for (const node of run.nodes) node.remove();
      undo.push(() => {
        parts[i]![0]!.replaceWith(...run.nodes);
        for (const spacer of parts[i]!.slice(1)) spacer.remove();
      });
    });
    // Margins and cell spacing can make a run's height differ from its rows; settle on the
    // retained element that follows each run, then check that nothing moved. The correction goes
    // to the run's first spacer; a parity spacer is never an anchor and never takes height.
    // Runs are settled in document order, each measured after the earlier ones were written, so
    // what its anchor still shows is its own share. Runs in different trees keep their order.
    const anchorOf = (spacer: Element): Element | null => {
      for (
        let p: Element | null = spacer;
        p;
        p = p.parentElement ?? (p.parentNode as ShadowRoot).host
      )
        if (p.nextElementSibling) return p.nextElementSibling;
      return null;
    };
    const ordered = inTreeOrder(parts);
    const settle = (spacers: HTMLElement[]): void => {
      const [first] = spacers;
      if (first!.style.display === 'none') return;
      const anchor = anchorOf(starts.get(first!) ?? spacers.at(-1)!);
      const saved = anchor && keep.get(anchor);
      if (!anchor || !saved) return;
      const moved = saved.top - anchor.getBoundingClientRect().top;
      if (moved) setHeight(first!, Math.max(0, Number.parseFloat(first!.style.height) + moved));
    };
    ordered.forEach(settle);
    for (const [el, r] of keep) {
      const now = el.getBoundingClientRect();
      if (!inView(win, el, r) && !inView(win, el, now)) continue;
      const is = clip(win, now);
      if (!clip(win, r).every((v, i) => near(v, is[i]!)))
        throw new Error('shot pruning moved the layout');
    }
  } catch (error) {
    restore();
    throw error;
  }
  return restore;
}

export async function renderFrame(win: Window, host: HTMLElement): Promise<Frame> {
  const override = configOf(win)?.shotRender;
  const render: Render = typeof override === 'function' ? (override as Render) : toCanvas;
  const restore = prune(win, host);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('shot render timed out')), RENDER_TIMEOUT_MS);
    });
    const canvas = await Promise.race([
      render(win.document.documentElement, {
        width: win.innerWidth,
        height: win.innerHeight,
        pixelRatio: 1,
        cacheBust: false,
        // Shifted by margin, not transform: a transformed root would become the containing block
        // of fixed content and break sticky offsets, which both need the picture's own viewport.
        style: { margin: `${-win.scrollY}px 0 0 ${-win.scrollX}px` },
        filter: (node: Node) => node !== host && !hidden.has(node as Element),
        includeStyleProperties: STYLE_PROPERTIES,
        imagePlaceholder: PLACEHOLDER,
      }),
      timeout,
    ]);
    return { source: canvas, width: canvas.width, height: canvas.height };
  } finally {
    clearTimeout(timer);
    restore();
  }
}
