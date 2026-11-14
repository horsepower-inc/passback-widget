import type { Code } from '@passback/schema';
import { MAX_CHAIN } from './react';

interface VueInstance {
  readonly type?: Record<string, unknown>;
  readonly parent?: VueInstance | null;
}

type ChainEntry = Code['chain'][number];

const UNKNOWN_RESULT: Pick<Code, 'framework' | 'chain'> = { framework: 'unknown', chain: [] };

function findInstance(el: Element): VueInstance | undefined {
  let node: Element | null = el;
  while (node) {
    const found = (node as unknown as { __vueParentComponent?: VueInstance }).__vueParentComponent;
    if (found) return found;
    node = node.parentElement;
  }
  return undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function fileBaseName(file: string | undefined): string | undefined {
  if (!file) return undefined;
  const base = file.split(/[\\/]/).pop() ?? '';
  return str(base.replace(/\.vue$/, ''));
}

function entryOf(instance: VueInstance): ChainEntry | undefined {
  const type = instance.type;
  const file = str(type?.__file);
  const name = str(type?.__name) ?? str(type?.name) ?? fileBaseName(file);
  if (name === undefined) return undefined;
  return file === undefined ? { name } : { name, file };
}

export function collectVueChain(el: Element): Pick<Code, 'framework' | 'chain'> {
  try {
    let current = findInstance(el);
    if (!current) return UNKNOWN_RESULT;
    const chain: ChainEntry[] = [];
    while (current && chain.length < MAX_CHAIN) {
      const entry = entryOf(current);
      if (entry) chain.push(entry);
      current = current.parent ?? undefined;
    }
    return { framework: 'vue', chain: chain.reverse() };
  } catch {
    return UNKNOWN_RESULT;
  }
}
