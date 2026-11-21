export const MASK_ATTR = 'data-passback-mask';
export const MASK_CHAR = '•';

export function isMasked(el: Element): boolean {
  return el.closest(`[${MASK_ATTR}]`) !== null;
}

export const EDITABLE_SELECTOR = '[contenteditable]:not([contenteditable="false"]), [role="textbox"]';

export function isEditable(el: Element): boolean {
  return el.closest(EDITABLE_SELECTOR) !== null;
}

export function maskText(text: string): string {
  return text.replace(/\S/g, MASK_CHAR);
}
