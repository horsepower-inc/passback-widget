// dev-mode data-source injection, the pure transform ('s Vite hook wires this in).

import { parse } from '@babel/parser';
import MagicString, { type SourceMap } from 'magic-string';
import type { Node as BabelNode } from '@babel/types';

export type SourceLoc = { file: string; line: number; col: number };

export function formatLoc(loc: SourceLoc): string {
  return `${loc.file}:${loc.line}:${loc.col}`;
}

type AnyNode = BabelNode & Record<string, unknown>;

function isNode(value: unknown): value is AnyNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

const SKIP_KEYS = new Set([
  'loc',
  'start',
  'end',
  'range',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'extra',
]);

function walk(node: unknown, visit: (n: AnyNode) => void): void {
  if (!isNode(node)) return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = (node as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit);
    } else if (isNode(value)) {
      walk(value, visit);
    }
  }
}

function isHostElement(node: AnyNode): boolean {
  if (node.type !== 'JSXOpeningElement') return false;
  const name = node['name'] as AnyNode;
  return name.type === 'JSXIdentifier' && /^[a-z]/.test((name as { name: string }).name);
}

function hasOwnSourceOrIgnore(node: AnyNode): boolean {
  const attributes = node['attributes'] as AnyNode[];
  return attributes.some((attr) => {
    if (attr.type !== 'JSXAttribute') return false;
    const attrName = attr['name'] as AnyNode;
    if (attrName.type !== 'JSXIdentifier') return false;
    const name = (attrName as { name: string }).name;
    return name === 'data-source' || name === 'data-passback-ignore';
  });
}

function insertionPoint(node: AnyNode): number {
  const name = node['name'] as { end: number };
  return name.end;
}

function elementLoc(node: AnyNode, relPath: string): SourceLoc {
  const loc = node.loc as { start: { line: number; column: number } };
  return { file: relPath, line: loc.start.line, col: loc.start.column + 1 };
}

export function injectSource(
  code: string,
  relPath: string,
  format: (loc: SourceLoc) => string = formatLoc,
): { code: string; map: SourceMap } | null {
  let ast;
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  } catch {
    return null;
  }

  const s = new MagicString(code);
  let inserted = false;

  walk(ast, (node) => {
    if (!isHostElement(node) || hasOwnSourceOrIgnore(node)) return;
    const value = format(elementLoc(node, relPath));
    s.appendLeft(insertionPoint(node), ` data-source={${JSON.stringify(value)}}`);
    inserted = true;
  });

  if (!inserted) return null;
  return { code: s.toString(), map: s.generateMap({ hires: true, source: relPath }) };
}
