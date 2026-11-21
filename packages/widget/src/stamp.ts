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

const TILT = (-8 * Math.PI) / 180;
const POP_SCALE = 1.7;

function size(stamp: HTMLElement): { w: number; h: number } {
  const rect = stamp.getBoundingClientRect();
  return { w: stamp.offsetWidth || rect.width, h: stamp.offsetHeight || rect.height };
}

// Extent of the tilted, popped stamp around its bottom-left origin (transform-origin 0 100%).
function reach(w: number, h: number) {
  const cos = Math.cos(TILT);
  const sin = Math.sin(TILT);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [0, 0],
    [w * POP_SCALE, 0],
    [0, -h * POP_SCALE],
    [w * POP_SCALE, -h * POP_SCALE],
  ] as const) {
    xs.push(x * cos - y * sin);
    ys.push(x * sin + y * cos);
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Opens toward the page: the usual offset where the whole stamp fits, else flipped, else clamped.
export function moveStamp(stamp: HTMLElement, pin: { x: number; y: number }): void {
  let left = pin.x + OFFSET_X;
  let top = pin.y - OFFSET_Y;
  const { w, h } = size(stamp);
  const view = stamp.ownerDocument.documentElement;
  const vw = view.clientWidth || stamp.ownerDocument.defaultView?.innerWidth || 0;
  const vh = view.clientHeight || stamp.ownerDocument.defaultView?.innerHeight || 0;
  if (w > 0 && h > 0 && vw > 0 && vh > 0) {
    const r = reach(w, h);
    const fitsX = (l: number) => l + r.minX >= 0 && l + r.maxX <= vw;
    const fitsY = (t: number) => t + h + r.minY >= 0 && t + h + r.maxY <= vh;
    if (!fitsX(left)) left = pin.x - OFFSET_X - w;
    if (!fitsY(top)) top = pin.y < vh / 2 ? pin.y + OFFSET_Y : pin.y - OFFSET_Y - h;
    left = clamp(left, -r.minX, Math.max(-r.minX, vw - r.maxX));
    top = clamp(top, -r.minY - h, Math.max(-r.minY - h, vh - r.maxY - h));
  }
  stamp.style.left = `${left}px`;
  stamp.style.top = `${top}px`;
}

export function showStamp(root: ShadowRoot, pin: { x: number; y: number }): HTMLElement {
  const stamp = document.createElement('div');
  stamp.className = STAMP_CLASS;
  stamp.setAttribute('aria-hidden', 'true');
  stamp.textContent = STAMP_TEXT;
  stamp.addEventListener('animationend', () => stamp.remove());
  // Attached first: a detached stamp measures zero and could not be contained.
  root.appendChild(stamp);
  moveStamp(stamp, pin);
  return stamp;
}
