// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { MAX_CHAIN } from './react';
import { collectVueChain } from './vue';

interface FakeInstance {
  type: Record<string, unknown>;
  parent: FakeInstance | null;
}

function inst(type: Record<string, unknown>, parent: FakeInstance | null = null): FakeInstance {
  return { type, parent };
}

function attach(el: Element, instance: unknown): void {
  (el as unknown as Record<string, unknown>)['__vueParentComponent'] = instance;
}

function makeEl(): HTMLElement {
  document.body.innerHTML = '<div id="outer"><span id="el"></span></div>';
  return document.getElementById('el')!;
}

describe('collectVueChain', () => {
  it('returns unknown with an empty chain when no element carries an instance', () => {
    expect(collectVueChain(makeEl())).toEqual({ framework: 'unknown', chain: [] });
  });

  it('builds the chain outermost first from parent links', () => {
    const el = makeEl();
    const app = inst({ __name: 'App' });
    const page = inst({ __name: 'Page' }, app);
    attach(el, inst({ __name: 'Button' }, page));
    expect(collectVueChain(el)).toEqual({
      framework: 'vue',
      chain: [{ name: 'App' }, { name: 'Page' }, { name: 'Button' }],
    });
  });

  it('names a component from __name, then name, then the file name', () => {
    const el = makeEl();
    const c = inst({ __file: '/src/components/Card.vue' });
    const b = inst({ name: 'Named', __file: '/src/B.vue' }, c);
    attach(el, inst({ __name: 'Script', name: 'Other' }, b));
    expect(collectVueChain(el).chain.map((e) => e.name)).toEqual(['Card', 'Named', 'Script']);
  });

  it('sets file from __file on each entry that has one and no line', () => {
    const el = makeEl();
    const outer = inst({ __name: 'Outer' });
    attach(el, inst({ __name: 'Inner', __file: '/abs/Inner.vue' }, outer));
    const { chain } = collectVueChain(el);
    expect(chain).toEqual([{ name: 'Outer' }, { name: 'Inner', file: '/abs/Inner.vue' }]);
    expect(chain[1]).not.toHaveProperty('line');
  });

  it('finds the instance on an ancestor element', () => {
    const el = makeEl();
    attach(document.getElementById('outer')!, inst({ __name: 'Host' }));
    expect(collectVueChain(el)).toEqual({ framework: 'vue', chain: [{ name: 'Host' }] });
  });

  it('stops at MAX_CHAIN entries', () => {
    const el = makeEl();
    let current: FakeInstance | null = null;
    for (let i = MAX_CHAIN + 4; i > 0; i--) current = inst({ __name: `C${i}` }, current);
    attach(el, current);
    const { chain } = collectVueChain(el);
    expect(chain).toHaveLength(MAX_CHAIN);
    expect(chain[MAX_CHAIN - 1]).toEqual({ name: 'C1' });
  });

  it('skips an instance with no name', () => {
    const el = makeEl();
    const outer = inst({ __name: 'Outer' });
    attach(el, inst({}, inst({ __name: 'Inner' }, outer)));
    expect(collectVueChain(el).chain).toEqual([{ name: 'Outer' }, { name: 'Inner' }]);
    const bare = makeEl();
    attach(bare, inst({}));
    expect(collectVueChain(bare)).toEqual({ framework: 'vue', chain: [] });
  });

  it('returns unknown when reading an instance throws', () => {
    const el = makeEl();
    attach(el, {
      get type(): never {
        throw new Error('boom');
      },
      parent: null,
    });
    expect(collectVueChain(el)).toEqual({ framework: 'unknown', chain: [] });
  });
});
