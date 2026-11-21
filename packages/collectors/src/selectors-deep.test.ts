// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  MAX_CSS_ANCESTOR_LEVELS,
  MAX_CSS_CANDIDATES,
  resolveSelector,
  selectorChain,
} from './selectors';

function css(el: Element): string {
  const sel = selectorChain(el).find((s) => s.kind === 'css');
  if (!sel) throw new Error('no css selector');
  return sel.value;
}

describe('deep css selectors', () => {
  it('finds a three-ancestor descendant chain before using position', () => {
    const chains = ['a/b/c', 'a/b/x', 'a/x/c', 'x/b/c'];
    document.body.innerHTML = chains
      .map((c) => {
        const [o, m, i] = c.split('/');
        return `<div class="${o}"><div class="${m}"><div class="${i}"><b></b></div></div></div>`;
      })
      .join('');
    const target = document.querySelector('b')!;
    const value = css(target);
    expect(value).not.toContain(':nth-of-type');
    expect(document.querySelector(value)).toBe(target);
    expect(document.querySelectorAll(value)).toHaveLength(1);

    const first = document.body.firstElementChild!;
    document.body.appendChild(first);
    expect(resolveSelector(document, { kind: 'css', value })).toBe(target);
  });

  it('finds a child-combinator chain before using position', () => {
    document.body.innerHTML =
      '<div class="a"><div class="b"><b></b></div></div><div class="a"><span><div class="b"><b></b></div></span></div>';
    const target = document.querySelector('b')!;
    const value = css(target);
    expect(value).not.toContain(':nth-of-type');
    expect(value).toContain('>');
    expect(document.querySelector(value)).toBe(target);

    document.body.appendChild(document.body.firstElementChild!);
    expect(resolveSelector(document, { kind: 'css', value })).toBe(target);
  });

  it('stops at its search bound and falls back to position', () => {
    expect(MAX_CSS_ANCESTOR_LEVELS).toBe(8);
    expect(MAX_CSS_CANDIDATES).toBe(256);
    const depth = MAX_CSS_ANCESTOR_LEVELS + 2;
    const nest = (cls: string) =>
      `<div class="${cls}">${'<section>'.repeat(depth)}<b></b>${'</section>'.repeat(depth)}</div>`;
    document.body.innerHTML = nest('far') + nest('other');
    const target = document.querySelector('b')!;
    const value = css(target);
    expect(value).toContain(':nth-of-type');
    expect(document.querySelector(value)).toBe(target);
    expect(document.querySelectorAll(value)).toHaveLength(1);
  });
});
