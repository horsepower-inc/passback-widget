import type { Element as ElementData } from '@passback/schema';
import { EDITABLE_SELECTOR, isEditable } from './mask';
import { reactComponentPath } from './react';

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
  clone
    .querySelectorAll(`textarea, select, option, ${EDITABLE_SELECTOR}`)
    .forEach((node) => node.remove());
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

// Recognizably generated tokens: CSS modules (`_btn_1x2y3`), styled-components (`sc-*`),
// emotion (`css-*`) and arbitrary-value utilities (`w-[10px]`).
function isGeneratedToken(token: string): boolean {
  return /^_.*_/.test(token) || /^sc-/.test(token) || /^css-/.test(token) || token.includes('[');
}

function escapeIdent(value: string): string {
  if (value === '-') return '\\-';
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charAt(i);
    const code = value.charCodeAt(i);
    if (code === 0) out += '�';
    else if (code < 0x20 || code === 0x7f || (i === 0 && ch >= '0' && ch <= '9')) {
      out += `\\${code.toString(16)} `;
    } else if (i === 1 && value.charAt(0) === '-' && ch >= '0' && ch <= '9') {
      out += `\\${code.toString(16)} `;
    } else if (code >= 0x80 || /[A-Za-z0-9_-]/.test(ch)) out += ch;
    else out += `\\${ch}`;
  }
  return out;
}

// A CSS string body: backslash, quote and control characters (newlines included) escaped.
function escapeCssString(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charAt(i);
    const code = value.charCodeAt(i);
    if (code === 0) out += '\uFFFD';
    else if (code < 0x20 || code === 0x7f) out += `\\${code.toString(16)} `;
    else if (ch === '\\' || ch === '"') out += `\\${ch}`;
    else out += ch;
  }
  return out;
}

function usableId(el: Element): string | null {
  const id = el.id;
  if (!id || !/^[A-Za-z][\w-]*$/.test(id) || isGeneratedToken(id)) return null;
  return el.ownerDocument.querySelectorAll(`#${id}`).length === 1 ? id : null;
}

function matchesOnly(doc: Document, value: string, el: Element): boolean {
  try {
    const found = doc.querySelectorAll(value);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

// tag + eligible id + stable classes (+ nonempty testid for ancestors). `anchored` is true
// when the identity carries more than the tag.
function identity(el: Element, withTestid: boolean): { text: string; anchored: boolean } {
  let text = el.tagName.toLowerCase();
  let anchored = false;
  const id = usableId(el);
  if (id) {
    text += `#${id}`;
    anchored = true;
  }
  const seen = new Set<string>();
  for (const cls of Array.from(el.classList)) {
    if (!cls || seen.has(cls) || isGeneratedToken(cls)) continue;
    seen.add(cls);
    text += `.${escapeIdent(cls)}`;
    anchored = true;
  }
  if (withTestid) {
    const testid = el.getAttribute('data-testid');
    if (testid) {
      text += `[data-testid="${escapeCssString(testid)}"]`;
      anchored = true;
    }
  }
  return { text, anchored };
}

// Search bounds for the stable css search: ancestor levels examined, candidate selectors tested.
export const MAX_CSS_ANCESTOR_LEVELS = 8;
export const MAX_CSS_CANDIDATES = 256;

function stableCss(el: Element): string | null {
  const doc = el.ownerDocument;
  const local = identity(el, false).text;
  if (matchesOnly(doc, local, el)) return local;

  const ancestors: { text: string; level: number }[] = [];
  let level = 0;
  for (
    let cur = el.parentElement;
    cur && level < MAX_CSS_ANCESTOR_LEVELS;
    cur = cur.parentElement
  ) {
    const tag = cur.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') break;
    level += 1;
    const ident = identity(cur, true);
    if (ident.anchored) ancestors.push({ text: ident.text, level });
    if (usableId(cur)) break;
  }

  let tested = 0;
  // Subsets of anchored ancestors, fewest first, nearest first within a size; each joined
  // with descendant combinators, then with child combinators where the levels are adjacent.
  const tryPick = (picked: number[]): string | null => {
    const outerFirst = [...picked].reverse();
    const descendant = outerFirst.map((i) => ancestors[i]!.text).join(' ');
    const variants = [`${descendant} ${local}`];
    let child = '';
    let hasChild = false;
    outerFirst.forEach((idx, n) => {
      const cur = ancestors[idx]!;
      const next = outerFirst[n + 1];
      const nextLevel = next === undefined ? 0 : ancestors[next]!.level;
      const adjacent = cur.level - nextLevel === 1;
      hasChild = hasChild || adjacent;
      child += `${cur.text}${adjacent ? ' > ' : ' '}`;
    });
    if (hasChild) variants.push(`${child}${local}`);
    for (const value of variants) {
      if (tested >= MAX_CSS_CANDIDATES) return null;
      tested += 1;
      if (matchesOnly(doc, value, el)) return value;
    }
    return null;
  };
  const search = (size: number, start: number, picked: number[]): string | null => {
    if (picked.length === size) return tryPick(picked);
    for (let i = start; i < ancestors.length; i += 1) {
      if (tested >= MAX_CSS_CANDIDATES) return null;
      const found = search(size, i + 1, [...picked, i]);
      if (found) return found;
    }
    return null;
  };
  for (let size = 1; size <= ancestors.length; size += 1) {
    const found = search(size, 0, []);
    if (found) return found;
  }
  return null;
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
  const stable = stableCss(el);
  if (stable) return stable;

  const chain: Element[] = [el];
  let current = el.parentElement;
  let anchor = 'body';
  while (current) {
    const id = usableId(current);
    if (id) {
      anchor = `#${id}`;
      break;
    }
    const tag = current.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') {
      anchor = tag;
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

  const reactPath = reactComponentPath(el);
  if (reactPath !== undefined) chain.push({ kind: 'react', value: reactPath });

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
