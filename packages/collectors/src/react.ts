import type { Code, Payload } from '@passback/schema';
import { redact } from '@passback/schema/redact';

export interface Fiber {
  readonly tag: number;
  readonly type: unknown;
  readonly return: Fiber | null;
  readonly memoizedProps?: unknown;
}

export const MAX_CHAIN = 8;
export const MAX_HOPS = 1000;

const FIBER_KEY_PREFIX = '__reactFiber$';
const DATA_SOURCE_RE = /^(.+):(\d+):(\d+)$/;
const HASH_SOURCE_RE = /^[0-9a-f]{8}$/;

type ChainEntry = Code['chain'][number];

function fiberKey(el: Element): string | undefined {
  return Object.keys(el).find((key) => key.startsWith(FIBER_KEY_PREFIX));
}

export function findFiber(el: Element): Fiber | undefined {
  let node: Element | null = el;
  while (node) {
    const key = fiberKey(node);
    if (key) return (node as unknown as Record<string, Fiber>)[key];
    node = node.parentElement;
  }
  return undefined;
}

function propOf<T>(value: unknown, key: string): T | undefined {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    return (value as Record<string, T>)[key];
  }
  return undefined;
}

function nonEmpty(name: string | undefined): string | undefined {
  return name ? name : undefined;
}

function nameOf(value: unknown): string | undefined {
  return nonEmpty(propOf<string>(value, 'displayName') ?? propOf<string>(value, 'name'));
}

function forwardRefName(type: unknown): string | undefined {
  return nonEmpty(propOf<string>(type, 'displayName')) ?? nameOf(propOf<unknown>(type, 'render'));
}

function memoComponentName(type: unknown): string | undefined {
  return nonEmpty(propOf<string>(type, 'displayName')) ?? nameOf(propOf<unknown>(type, 'type'));
}

const NAME_BY_TAG: Record<number, (type: unknown) => string | undefined> = {
  0: nameOf,
  1: nameOf,
  15: nameOf,
  11: forwardRefName,
  14: memoComponentName,
};

export function componentName(fiber: Fiber): string | undefined {
  const resolve = NAME_BY_TAG[fiber.tag];
  return resolve ? resolve(fiber.type) : undefined;
}

function isComponentTag(tag: number): boolean {
  return tag in NAME_BY_TAG;
}

export function nearestComponentFiber(el: Element): Fiber | undefined {
  let fiber = findFiber(el);
  for (let hops = 0; fiber && hops < MAX_HOPS; hops += 1) {
    if (isComponentTag(fiber.tag)) return fiber;
    fiber = fiber.return ?? undefined;
  }
  return undefined;
}

const UNKNOWN_RESULT: Pick<Code, 'framework' | 'chain'> = { framework: 'unknown', chain: [] };

interface ChainResult {
  chain: ChainEntry[];
  innermost?: Fiber;
}

function buildChain(el: Element): ChainResult {
  const entries: { name: string; fiber: Fiber }[] = [];
  let current = findFiber(el);
  for (let hops = 0; current && hops < MAX_HOPS && entries.length < MAX_CHAIN; hops += 1) {
    const name = componentName(current);
    if (name !== undefined) entries.push({ name, fiber: current });
    current = current.return ?? undefined;
  }
  entries.reverse();
  return {
    chain: entries.map(({ name }) => ({ name })),
    innermost: entries[entries.length - 1]?.fiber,
  };
}

function applySource(source: string, last: ChainEntry, node: Element, innermost: Fiber): void {
  if (nearestComponentFiber(node) !== innermost) return;
  const match = DATA_SOURCE_RE.exec(source);
  if (match) {
    last.file = match[1];
    last.line = Number(match[2]);
    last.col = Number(match[3]);
    return;
  }
  if (HASH_SOURCE_RE.test(source)) {
    last.hash = source;
  }
}

function applyDataSource(el: Element, chain: ChainEntry[], innermost: Fiber | undefined): void {
  const last = chain[chain.length - 1];
  if (!last || !innermost) return;
  let node: Element | null = el;
  while (node) {
    const source = node.getAttribute('data-source');
    if (source) return applySource(source, last, node, innermost);
    node = node.parentElement;
  }
}

export function collectReactChain(el: Element): Pick<Code, 'framework' | 'chain'> {
  try {
    if (!findFiber(el)) return UNKNOWN_RESULT;
    const { chain, innermost } = buildChain(el);
    applyDataSource(el, chain, innermost);
    return { framework: 'react', chain };
  } catch {
    return UNKNOWN_RESULT;
  }
}

// A control character or a lone surrogate in a name makes the whole path unsafe.
function isUnsafeName(name: string): boolean {
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = name.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function redactsUnchanged(path: string): boolean {
  const probe = {
    element: {
      tag: 'div',
      attrs: {},
      text: '',
      outerHTML: '',
      selectors: [{ kind: 'react', value: path }],
    },
  } as unknown as Payload;
  const out = redact(probe) as unknown as { element: { selectors: { value: string }[] } };
  return out.element.selectors[0]?.value === path;
}

function ownFiber(el: Element): Fiber | undefined {
  const key = fiberKey(el);
  return key ? (el as unknown as Record<string, Fiber>)[key] : undefined;
}

/** The full component path, outermost first, joined by " > "; undefined when there is none or it is not safe whole. */
export function reactComponentPath(el: Element): string | undefined {
  try {
    let current = ownFiber(el);
    if (!current) return undefined;
    const names: string[] = [];
    let hops = 0;
    while (current) {
      if (hops >= MAX_HOPS) return undefined;
      hops += 1;
      const name = componentName(current);
      if (name !== undefined) names.push(name);
      current = current.return ?? undefined;
    }
    if (names.length === 0) return undefined;
    names.reverse();
    if (names.some((name) => typeof name !== 'string' || isUnsafeName(name))) return undefined;
    const path = names.join(' > ');
    return redactsUnchanged(path) ? path : undefined;
  } catch {
    return undefined;
  }
}
