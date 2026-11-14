import type { Element as ElementData } from '@passback/schema';
import { EDITABLE_SELECTOR, isEditable } from './mask';

export type Selector = ElementData['selectors'][number];

const IMPLICIT_ROLES: Record<string, string> = {
  button: 'button',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  img: 'img',
};

function escapeAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function unescapeAttr(value: string): string {
  return value.replace(/\\(.)/g, '$1');
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function inputRole(el: Element): string | null {
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (type === 'checkbox') return 'checkbox';
  if (type === 'submit' || type === 'button') return 'button';
  return null;
}

function implicitRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag in IMPLICIT_ROLES) return IMPLICIT_ROLES[tag] ?? null;
  if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
  if (tag === 'input') return inputRole(el);
  return null;
}

function computeRole(el: Element): string | null {
  return el.getAttribute('role') || implicitRole(el);
}

function nameText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(`textarea, select, option, ${EDITABLE_SELECTOR}`).forEach((node) => node.remove());
  return collapseWhitespace(clone.textContent ?? '');
}

const FORM_CONTROL_TAGS = new Set(['textarea', 'select', 'option', 'input']);

function computeName(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();
  const tag = el.tagName.toLowerCase();
  if (tag === 'img') {
    const alt = el.getAttribute('alt');
    if (alt) return alt.trim();
  }
  if (FORM_CONTROL_TAGS.has(tag) || isEditable(el)) return '';
  return nameText(el);
}

function usableId(el: Element): string | null {
  const id = el.id;
  if (!id || !/^[A-Za-z][\w-]*$/.test(id)) return null;
  return el.ownerDocument.querySelectorAll(`#${id}`).length === 1 ? id : null;
}

function cssStep(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  if (sameTag.length <= 1) return tag;
  return `${tag}:nth-of-type(${sameTag.indexOf(el) + 1})`;
}

function cssPath(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'html' || tag === 'body') return tag;

  const chain: Element[] = [el];
  let current = el.parentElement;
  let anchor = 'body';
  while (current) {
    const id = usableId(current);
    if (id) {
      anchor = `#${id}`;
      break;
    }
    if (current.tagName.toLowerCase() === 'body') {
      anchor = 'body';
      break;
    }
    chain.unshift(current);
    current = current.parentElement;
  }
  return [anchor, ...chain.map(cssStep)].join(' > ');
}

function queryAllElements(root: Document | Element): Element[] {
  if (root instanceof Element) {
    return [root, ...Array.from(root.querySelectorAll('*'))];
  }
  return Array.from(root.querySelectorAll('*'));
}

function resolveRoleSelector(root: Document | Element, value: string): Element | null {
  const match = /^role=([^[]+)(?:\[name="((?:\\.|[^"\\])*)"\])?$/.exec(value);
  if (!match) return null;
  const role = match[1];
  const name = match[2] !== undefined ? unescapeAttr(match[2]) : '';
  const found = queryAllElements(root).filter(
    (el) => computeRole(el) === role && computeName(el) === name,
  );
  return found.length === 1 ? (found[0] ?? null) : null;
}

// Bypasses the host's CSS selector parser: attribute selectors with backslash-escaped
// quotes are valid CSS but not every engine (e.g. happy-dom) parses them.
function resolveAttrSelector(
  root: Document | Element,
  attr: string,
  value: string,
): Element | null {
  const match = new RegExp(`^\\[${attr}="((?:\\\\.|[^"\\\\])*)"\\]$`).exec(value);
  if (!match) return null;
  const expected = unescapeAttr(match[1] ?? '');
  const found = queryAllElements(root).filter((el) => el.getAttribute(attr) === expected);
  return found.length === 1 ? (found[0] ?? null) : null;
}

export function resolveSelector(root: Document | Element, selector: Selector): Element | null {
  if (selector.kind === 'role') return resolveRoleSelector(root, selector.value);
  if (selector.kind === 'testid') return resolveAttrSelector(root, 'data-testid', selector.value);
  if (selector.kind === 'id' && selector.value.startsWith('[')) {
    return resolveAttrSelector(root, 'id', selector.value);
  }
  const matches = root.querySelectorAll(selector.value);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function selectorChain(el: Element): Selector[] {
  const doc = el.ownerDocument;
  const chain: Selector[] = [];

  const testid = el.getAttribute('data-testid');
  if (testid) {
    const sel: Selector = { kind: 'testid', value: `[data-testid="${escapeAttr(testid)}"]` };
    if (resolveSelector(doc, sel) === el) chain.push(sel);
  }

  if (el.id) {
    const value = /^[A-Za-z][\w-]*$/.test(el.id) ? `#${el.id}` : `[id="${escapeAttr(el.id)}"]`;
    const sel: Selector = { kind: 'id', value };
    if (resolveSelector(doc, sel) === el) chain.push(sel);
  }

  const role = computeRole(el);
  const name = computeName(el);
  if (role && name) {
    const sel: Selector = { kind: 'role', value: `role=${role}[name="${escapeAttr(name)}"]` };
    if (resolveSelector(doc, sel) === el) chain.push(sel);
  }

  chain.push({ kind: 'css', value: cssPath(el) });
  return chain;
}
