import type { Element as ElementData } from '@passback/schema';
import { findByTagAndText } from './fuzzy-match';
import { resolveSelector, type Selector } from './selectors';

export type ResolveTarget = Pick<ElementData, 'selectors' | 'tag' | 'text'>;
export type Resolved = { element: Element; via: Selector['kind'] | 'text' };

function resolveOne(root: Document | Element, selector: Selector): Element | null {
  try {
    return resolveSelector(root, selector);
  } catch {
    return null;
  }
}

export function firstDomSelector(selectors: readonly Selector[]): Selector | undefined {
  return selectors.find((selector) => selector.kind !== 'react');
}

export function reresolve(root: Document | Element, target: ResolveTarget): Resolved | null {
  for (const selector of target.selectors) {
    if (selector.kind === 'react') continue;
    const element = resolveOne(root, selector);
    if (element) return { element, via: selector.kind };
  }

  const element = findByTagAndText(root, target.tag, target.text);
  if (element) return { element, via: 'text' };

  return null;
}
