import type { Element as ElementData } from '@passback/schema';
import { EDITABLE_SELECTOR, isEditable, isMasked, MASK_ATTR, maskText } from './mask';
import { selectorChain } from './selectors';

export const ATTR_ALLOWLIST = [
  'id',
  'class',
  'data-testid',
  'data-source',
  'role',
  'aria-label',
  'name',
  'type',
  'href',
  'alt',
  'title',
  'placeholder',
] as const;

export const TEXT_MAX = 200;
export const OUTER_HTML_MAX = 2048;

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const FORM_CONTROL_SELECTOR = `input, textarea, select, option, ${EDITABLE_SELECTOR}`;

function stripFormValues(nodes: Element[]): void {
  for (const node of nodes) {
    node.removeAttribute('value');
    const tag = node.tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'option' || node.matches(EDITABLE_SELECTOR)) {
      node.textContent = '';
    }
  }
}

function sanitizeTemplates(scope: ParentNode): void {
  for (const template of Array.from(scope.querySelectorAll('template'))) {
    const content = (template as HTMLTemplateElement).content;
    stripFormValues(Array.from(content.querySelectorAll(FORM_CONTROL_SELECTOR)));
    sanitizeTemplates(content);
  }
}

const MASKABLE_ATTRS = ['alt', 'title', 'placeholder', 'aria-label'] as const;

function maskTextNodes(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      child.textContent = maskText(child.textContent ?? '');
    } else {
      maskTextNodes(child);
    }
  }
}

function maskAttrsInSubtree(root: Element): void {
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const name of MASKABLE_ATTRS) {
      const value = el.getAttribute(name);
      if (value !== null) el.setAttribute(name, maskText(value));
    }
  }
}

function maskSubtree(root: Element): void {
  maskTextNodes(root);
  maskAttrsInSubtree(root);
}

function sanitizeClone(clone: Element): Element {
  stripFormValues([clone, ...Array.from(clone.querySelectorAll(FORM_CONTROL_SELECTOR))]);
  sanitizeTemplates(clone);
  if (clone.tagName.toLowerCase() === 'template') {
    const content = (clone as HTMLTemplateElement).content;
    stripFormValues(Array.from(content.querySelectorAll(FORM_CONTROL_SELECTOR)));
    sanitizeTemplates(content);
  }
  return clone;
}

export function collectElement(el: Element): ElementData {
  const attrs: Record<string, string> = {};
  for (const name of ATTR_ALLOWLIST) {
    const value = el.getAttribute(name);
    if (value !== null) attrs[name] = value;
  }

  const clone = sanitizeClone(el.cloneNode(true) as Element);
  if (isEditable(el)) clone.textContent = '';

  if (isMasked(el)) {
    maskSubtree(clone);
    for (const name of MASKABLE_ATTRS) {
      if (attrs[name] !== undefined) attrs[name] = maskText(attrs[name]);
    }
  } else {
    for (const masked of Array.from(clone.querySelectorAll(`[${MASK_ATTR}]`))) {
      maskSubtree(masked);
    }
  }

  return {
    selectors: selectorChain(el),
    tag: el.tagName.toLowerCase(),
    attrs,
    text: collapseWhitespace(clone.textContent ?? '').slice(0, TEXT_MAX),
    outerHTML: clone.outerHTML.slice(0, OUTER_HTML_MAX),
  };
}
