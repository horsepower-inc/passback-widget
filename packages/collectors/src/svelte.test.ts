// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { assemblePayload } from './assemble';
import { collectSvelteChain } from './svelte';

function tag(el: Element, file: string): void {
  (el as unknown as Record<string, unknown>)['__svelte_meta'] = {
    loc: { file, line: 1, column: 0 },
  };
}

function build(): HTMLElement {
  document.body.innerHTML =
    '<div id="app"><section id="page"><div id="card-a"><div id="card-b"><button id="el"></button></div></div></section></div>';
  return document.getElementById('el')!;
}

function assemble(el: Element) {
  return assemblePayload({ el, comment: 'c', win: window, timeline: [] });
}

describe('collectSvelteChain', () => {
  it('names the Svelte components around a marked element, outermost first', () => {
    const el = build();
    tag(document.getElementById('app')!, 'src/App.svelte');
    tag(document.getElementById('page')!, 'src/routes/Page.svelte');
    tag(document.getElementById('card-a')!, 'src/lib/Card.svelte');
    tag(document.getElementById('card-b')!, 'src/lib/Card.svelte');
    tag(el, 'src\\lib\\Button.svelte');
    const code = assemble(el).code;
    expect(code.framework).toBe('svelte');
    expect(code.chain).toEqual([
      { name: 'App', file: 'src/App.svelte' },
      { name: 'Page', file: 'src/routes/Page.svelte' },
      { name: 'Card', file: 'src/lib/Card.svelte' },
      { name: 'Button', file: 'src\\lib\\Button.svelte' },
    ]);
  });

  it('reads the Svelte chain under an unnamed Vue root that gives no chain', () => {
    const el = build();
    (document.getElementById('app') as unknown as Record<string, unknown>)['__vueParentComponent'] =
      { type: { render() {} }, parent: null };
    tag(document.getElementById('page')!, 'src/routes/Page.svelte');
    tag(el, 'src/lib/Button.svelte');
    const code = assemble(el).code;
    expect(code.framework).toBe('svelte');
    expect(code.chain.map((e) => e.name)).toEqual(['Page', 'Button']);

    const plain = build();
    (document.getElementById('app') as unknown as Record<string, unknown>)['__vueParentComponent'] =
      { type: { render() {} }, parent: null };
    expect(assemble(plain).code).toMatchObject({ framework: 'vue', chain: [] });
  });

  it('gives framework unknown when the page has no Svelte metadata', () => {
    const el = build();
    expect(collectSvelteChain(el)).toEqual({ framework: 'unknown', chain: [] });
    Object.defineProperty(el, '__svelte_meta', {
      get() {
        throw new Error('boom');
      },
    });
    expect(collectSvelteChain(el)).toEqual({ framework: 'unknown', chain: [] });
    expect(assemble(el).code.framework).toBe('unknown');
  });

  it('keeps the React and Vue chains as today', () => {
    const el = build();
    tag(document.getElementById('app')!, 'src/App.svelte');
    (el as unknown as Record<string, unknown>)['__vueParentComponent'] = {
      type: { __name: 'VueThing' },
      parent: null,
    };
    const vue = assemble(el).code;
    expect(vue.framework).toBe('vue');
    expect(vue.chain).toEqual([{ name: 'VueThing' }]);

    const el2 = build();
    tag(document.getElementById('app')!, 'src/App.svelte');
    (el2 as unknown as Record<string, unknown>)['__reactFiber$x'] = {
      tag: 0,
      type: function Widget() {},
      return: null,
    };
    const react = assemble(el2).code;
    expect(react.framework).toBe('react');
    expect(react.chain.map((e) => e.name)).toEqual(['Widget']);
  });
});
