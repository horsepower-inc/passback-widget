import type { PinCtx } from './corner-pins';
import { targetOf } from './corner-pins';
import type { TrackedMark } from './overlay-reattach';

const RULES = `
.pb-target-outline { position: fixed; box-sizing: border-box; pointer-events: none; outline: 1.5px solid var(--pb-color-accent); outline-offset: 2px; border-radius: var(--pb-radius-control); }
.pb-target-outline[hidden] { display: none; }
:host([data-pb-hide]) .pb-target-outline { display: none !important; }
`;

// Measurable and on screen: an off-screen target's offset outline would peek in at the edge.
const drawable = (r: DOMRect, win: Window): boolean =>
  [r.left, r.top, r.width, r.height].every(Number.isFinite) &&
  r.width > 0 &&
  r.height > 0 &&
  r.bottom > 0 &&
  r.right > 0 &&
  r.top < win.innerHeight &&
  r.left < win.innerWidth;

/** Collector-chunk add-on: a thin outline on the target of the hovered, highlighted or selected mark. */
export function targetOutline(ctx: PinCtx): void {
  const { root, host, state } = ctx;
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;
  const style = doc.createElement('style');
  style.setAttribute('data-pb-target-outline-styles', '');
  style.textContent = RULES;
  const node = doc.createElement('div');
  node.className = 'pb-target-outline';
  node.setAttribute('part', 'target-outline');
  node.hidden = true;
  root.append(style, node);
  let hovered: TrackedMark | null = null;
  let highlighted: string | null = null;

  const markOf = (event: Event): TrackedMark | null => {
    const at = event.target as Node | null;
    return (at && state.marks.find((mark) => mark.dot.element.contains(at))) || null;
  };
  const current = (): TrackedMark | null => {
    if (hovered && state.marks.includes(hovered)) return hovered;
    const named = highlighted === null ? null : state.marks.find((m) => m.id === highlighted);
    if (named) return named;
    return state.dot === null ? null : (state.marks.find((m) => m.dot === state.dot) ?? null);
  };
  const paint = (): void => {
    try {
      const mark = current();
      const target = mark ? targetOf(ctx, mark) : null;
      const r = target?.isConnected ? target.getBoundingClientRect() : null;
      const ok = r !== null && drawable(r, win);
      node.hidden = !ok;
      if (!ok) return;
      node.style.left = `${r.left}px`;
      node.style.top = `${r.top}px`;
      node.style.width = `${r.width}px`;
      node.style.height = `${r.height}px`;
    } catch {
      node.hidden = true;
    }
  };
  const onOver = (event: Event): void => {
    hovered = markOf(event) ?? hovered;
    paint();
  };
  const onOut = (event: Event): void => {
    const mark = markOf(event);
    const next = (event as PointerEvent).relatedTarget as Node | null;
    if (mark && !(next && mark.dot.element.contains(next))) {
      if (hovered === mark) hovered = null;
      paint();
    }
  };
  const onHighlight = (event: Event): void => {
    const detail = (event as CustomEvent<{ id?: unknown } | null>).detail;
    if (!detail || typeof detail !== 'object' || !('id' in detail)) return;
    const { id } = detail;
    if (id === null) highlighted = null;
    else if (typeof id === 'string' && state.marks.some((mark) => mark.id === id)) highlighted = id;
    else return;
    paint();
  };

  const tree = new MutationObserver(paint);
  tree.observe(root, { childList: true });
  const dispose = (): void => {
    tree.disconnect();
    root.removeEventListener('pointerover', onOver);
    root.removeEventListener('pointerout', onOut);
    host.removeEventListener('passback:highlight', onHighlight);
    host.removeEventListener('passback:sync', paint);
    host.removeEventListener('passback:dispose', dispose);
    win.removeEventListener('scroll', paint, true);
    win.removeEventListener('resize', paint);
    node.remove();
    style.remove();
  };
  root.addEventListener('pointerover', onOver);
  root.addEventListener('pointerout', onOut);
  host.addEventListener('passback:highlight', onHighlight);
  host.addEventListener('passback:sync', paint);
  host.addEventListener('passback:dispose', dispose);
  win.addEventListener('scroll', paint, true);
  win.addEventListener('resize', paint);
  paint();
}
