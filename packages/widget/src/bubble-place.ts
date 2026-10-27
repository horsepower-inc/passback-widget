// a bubble opens right of and below its pin; near the right or bottom
// edge it flips left of the pin and moves up so it stays inside the viewport.
type Point = { x: number; y: number };
type Size = { width: number; height: number };

export function fitBeside(
  anchor: Point,
  size: Size,
  view: Size,
  gap: number,
): { left?: number; top?: number } {
  const fit: { left?: number; top?: number } = {};
  if (anchor.x + gap + size.width > view.width - gap) {
    fit.left = Math.max(gap, anchor.x - gap - size.width);
  }
  if (anchor.y + gap + size.height > view.height - gap) {
    fit.top = Math.max(gap, view.height - gap - size.height);
  }
  return fit;
}

export function placeBeside(element: HTMLElement, anchor: Point): void {
  element.style.left = `calc(${anchor.x}px + var(--pb-space-gap))`;
  element.style.top = `calc(${anchor.y}px + var(--pb-space-gap))`;
  const view = element.ownerDocument.defaultView;
  if (!view) return;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0) return;
  const parsed = Number.parseFloat(
    view.getComputedStyle(element).getPropertyValue('--pb-space-gap'),
  );
  const gap = parsed || 8;
  const fit = fitBeside(
    anchor,
    { width: rect.width, height: rect.height },
    { width: view.innerWidth, height: view.innerHeight },
    gap,
  );
  if (fit.left !== undefined) element.style.left = `${fit.left}px`;
  if (fit.top !== undefined) element.style.top = `${fit.top}px`;
}
