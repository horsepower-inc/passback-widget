// a docked bubble sits one gap above the kept-comments tray; a tray too
// tall to fit beside it is squeezed to its header pill while the bubble is docked.
const SQUEEZED = 'data-squeezed';

export function undock(element: HTMLElement, root: ShadowRoot): void {
  element.style.removeProperty('bottom');
  root.querySelector('.pb-tray')?.removeAttribute(SQUEEZED);
}

export function dockAbove(element: HTMLElement, root: ShadowRoot): void {
  undock(element, root);
  const tray = root.querySelector<HTMLElement>('.pb-tray');
  const view = element.ownerDocument.defaultView;
  if (!tray || !view || tray.getBoundingClientRect().height === 0) return;
  const gap = Number.parseFloat(view.getComputedStyle(element).getPropertyValue('--pb-space-gap'));
  const room = element.getBoundingClientRect().height + (gap || 8) * 2;
  if (room + tray.getBoundingClientRect().height > view.innerHeight) tray.setAttribute(SQUEEZED, '');
  const bottom = view.innerHeight - tray.getBoundingClientRect().top;
  element.style.bottom = `calc(${bottom}px + var(--pb-space-gap))`;
}
