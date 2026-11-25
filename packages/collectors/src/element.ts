import type { Element as ElementData, Payload } from '@passback/schema';
import { redact } from '@passback/schema/redact';
import { EDITABLE_SELECTOR, isEditable, isMasked, MASK_ATTR, maskText } from './mask';
import { safeHref } from './route';
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

const ADDRESS_ATTRS = [
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'data',
  'cite',
  'xlink:href',
];
const ADDRESS_LIST_ATTRS = ['srcset', 'ping'];

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

function redactAddresses(scope: Element | DocumentFragment, self?: Element): void {
  const nodes = Array.from(scope.querySelectorAll('*'));
  if (self) nodes.unshift(self);
  for (const node of nodes) {
    for (const name of ADDRESS_ATTRS) {
      const value = node.getAttribute(name);
      if (value === null) continue;
      const safe = safeHref(value);
      if (safe !== value) node.setAttribute(name, safe);
    }
    for (const name of ADDRESS_LIST_ATTRS) {
      const value = node.getAttribute(name);
      if (value === null) continue;
      const safe = value
        .split(/(\s+)/)
        .map((part) => (/^\s*$/.test(part) ? part : safeHref(part)))
        .join('');
      if (safe !== value) node.setAttribute(name, safe);
    }
    if (node.tagName.toLowerCase() === 'template') {
      redactAddresses((node as HTMLTemplateElement).content);
    }
  }
}

const PATH_MAX_SEGMENTS = 8;
const PATH_SEGMENT_MAX = 120;

function pathSegment(node: Element): string {
  const tag = node.tagName.toLowerCase();
  const testid = node.getAttribute('data-testid');
  if (testid) return `${tag}[data-testid="${testid}"]`;
  const id = node.getAttribute('id');
  if (id) return `${tag}#${id}`;
  const role = node.getAttribute('role');
  if (role) return `${tag}[role="${role}"]`;
  const label = node.getAttribute('aria-label');
  if (label) return `${tag}[aria-label="${isMasked(node) ? maskText(label) : label}"]`;
  return tag;
}

// Redact the whole segment before the cut: a JWT cut before its second dot no longer matches
// redact(), so cutting first would let its claims through. runtime.ts cuts storage names the same way.
export function redactSegment(segment: string, cap: number): string {
  const probe = {
    element: {
      tag: 'div',
      attrs: {},
      text: '',
      outerHTML: '',
      // No `kind`: redact() never reads it, and the collect bundle sits at its size budget.
      selectors: [{ value: segment }],
    },
  } as unknown as Payload;
  // A missing selector throws here, and the caller omits its field.
  return (redact(probe).element.selectors[0] as { value: string }).value.slice(0, cap);
}

function collectPath(el: Element): string[] | undefined {
  try {
    const segments: string[] = [];
    for (
      let node: Element | null = el;
      node && segments.length < PATH_MAX_SEGMENTS;
      node = node.parentElement
    ) {
      segments.push(redactSegment(pathSegment(node), PATH_SEGMENT_MAX));
    }
    return segments.reverse();
  } catch {
    return undefined;
  }
}

export function collectElement(el: Element): ElementData {
  const attrs: Record<string, string> = {};
  for (const name of ATTR_ALLOWLIST) {
    const value = el.getAttribute(name);
    if (value !== null) attrs[name] = name === 'href' ? safeHref(value) : value;
  }

  const clone = sanitizeClone(el.cloneNode(true) as Element);
  if (isEditable(el)) clone.textContent = '';
  redactAddresses(clone, clone);

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

  const path = collectPath(el);
  return {
    selectors: selectorChain(el),
    tag: el.tagName.toLowerCase(),
    attrs,
    text: collapseWhitespace(clone.textContent ?? '').slice(0, TEXT_MAX),
    outerHTML: clone.outerHTML.slice(0, OUTER_HTML_MAX),
    ...(path ? { path } : {}),
  };
}
