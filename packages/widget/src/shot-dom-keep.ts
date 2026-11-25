// The children a container that lays them out in columns (grid, flex-wrap) must keep, as a table
// row keeps its cells, since one spacer cannot stand in for children that share a row; none when
// it stacks them. Geometry first, so a page of stacked blocks costs no style read. A hidden child
// takes no cell, so it stays out and a boxless spacer stands in. Reads only; writes nothing.
export function inColumns(win: Window, el: Element, children: Element[]): Element[] {
  let bottom = -Infinity;
  let beside = false;
  for (const child of children) {
    const r = child.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.top < bottom - 1) beside = true;
    bottom = r.bottom;
  }
  if (!beside || !/grid|flex/.test(win.getComputedStyle(el).getPropertyValue('display'))) return [];
  const display = (c: Element) => win.getComputedStyle(c).getPropertyValue('display');
  return children.filter((c) => display(c) !== 'none');
}

const STATE = /^(iframe|video|audio|object|embed)$/;

// Whether detaching the node would lose state: a frame, media, a plugin or a custom element in it.
export function holdsState(node: Element): boolean {
  const is = (e: Element): boolean => STATE.test(e.localName) || e.localName.includes('-');
  return is(node) || Array.from(node.querySelectorAll('*')).some(is);
}

export const hidden = new WeakSet<Element>();

// Hides nodes in place for the render; the undo removes the spacers and puts each style back.
export function hide(nodes: Element[], spacers: Element[]): () => void {
  const saved = nodes.map((n) => [n, n.getAttribute('style')] as const);
  for (const [n] of saved) {
    (n as HTMLElement).style.setProperty('display', 'none', 'important');
    hidden.add(n);
  }
  return () => {
    for (const spacer of spacers) spacer.remove();
    for (const [n, s] of saved) {
      hidden.delete(n);
      if (s === null) n.removeAttribute('style');
      else n.setAttribute('style', s);
    }
  };
}
