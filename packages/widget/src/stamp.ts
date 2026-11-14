export const STAMP_CLASS = 'pb-stamp';
export const STAMP_TEXT = 'Fixed ✓';

const OFFSET_X = 22;
const OFFSET_Y = 14;

export function stampRules(): string {
  return `.${STAMP_CLASS} {
  position: absolute;
  font: italic 900 20px/1 system-ui, sans-serif;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--pb-color-surface);
  text-shadow: 2px 2px 0 var(--pb-color-ok);
  transform-origin: 0 100%;
  animation: pb-stamp var(--pb-motion-stamp) var(--pb-motion-ease) forwards;
  pointer-events: none;
  white-space: nowrap;
}

@keyframes pb-stamp {
  0% { transform: rotate(-8deg) scale(1.7); opacity: 0; }
  12% { transform: rotate(-8deg) scale(1); opacity: 1; }
  80% { transform: rotate(-8deg) scale(1); opacity: 1; }
  100% { transform: rotate(-8deg) scale(1); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .${STAMP_CLASS} {
    display: none;
  }
}`;
}

export function moveStamp(stamp: HTMLElement, pin: { x: number; y: number }): void {
  stamp.style.left = `${pin.x + OFFSET_X}px`;
  stamp.style.top = `${pin.y - OFFSET_Y}px`;
}

export function showStamp(root: ShadowRoot, pin: { x: number; y: number }): HTMLElement {
  const stamp = document.createElement('div');
  stamp.className = STAMP_CLASS;
  stamp.setAttribute('aria-hidden', 'true');
  stamp.textContent = STAMP_TEXT;
  moveStamp(stamp, pin);
  stamp.addEventListener('animationend', () => stamp.remove());
  root.appendChild(stamp);
  return stamp;
}
