import { EDITABLE_SELECTOR, MASK_ATTR } from './mask';

export type MaskBox = { x: number; y: number; width: number; height: number };

export const SHOT_MASK_SELECTOR = `input, textarea, select, iframe, [${MASK_ATTR}], ${EDITABLE_SELECTOR}`;

function boxFor(el: Element, crop: MaskBox): MaskBox | null {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  const cropRight = crop.x + crop.width;
  const cropBottom = crop.y + crop.height;
  const left = Math.max(r.left, crop.x);
  const top = Math.max(r.top, crop.y);
  const right = Math.min(r.right, cropRight);
  const bottom = Math.min(r.bottom, cropBottom);
  if (right <= left || bottom <= top) return null;
  const x0 = Math.max(Math.floor(left), crop.x);
  const y0 = Math.max(Math.floor(top), crop.y);
  const x1 = Math.min(Math.ceil(right), cropRight);
  const y1 = Math.min(Math.ceil(bottom), cropBottom);
  return { x: x0 - crop.x, y: y0 - crop.y, width: x1 - x0, height: y1 - y0 };
}

export function shotMaskRects(root: ParentNode, crop: MaskBox, skip?: Element): MaskBox[] {
  const boxes: MaskBox[] = [];

  const walk = (node: ParentNode): void => {
    for (const el of Array.from(node.querySelectorAll('*'))) {
      if (el === skip) continue;
      const box = el.matches(SHOT_MASK_SELECTOR) ? boxFor(el, crop) : null;
      if (box) boxes.push(box);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };

  walk(root);
  return boxes;
}
