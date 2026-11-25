import type { Code } from '@passback/schema';
import { MAX_CHAIN } from './react';

type ChainEntry = Code['chain'][number];

const UNKNOWN_RESULT: Pick<Code, 'framework' | 'chain'> = { framework: 'unknown', chain: [] };

function entryOf(node: Element): ChainEntry | undefined {
  const meta = (node as unknown as { __svelte_meta?: { loc?: { file?: unknown } } }).__svelte_meta;
  const file = meta?.loc?.file;
  if (typeof file !== 'string' || file === '') return undefined;
  const base = file.split(/[\\/]/).pop() ?? '';
  const name = base.replace(/\.svelte$/, '');
  return name === '' ? undefined : { name, file };
}

export function collectSvelteChain(el: Element): Pick<Code, 'framework' | 'chain'> {
  try {
    const chain: ChainEntry[] = [];
    let node: Element | null = el;
    while (node && chain.length < MAX_CHAIN) {
      const entry = entryOf(node);
      const last = chain[chain.length - 1];
      if (entry && !(last && last.name === entry.name && last.file === entry.file)) {
        chain.push(entry);
      }
      node = node.parentElement;
    }
    if (chain.length === 0) return UNKNOWN_RESULT;
    return { framework: 'svelte', chain: chain.reverse() };
  } catch {
    return UNKNOWN_RESULT;
  }
}
