// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { collectElement } from '@passback/collectors';
import { collect } from './collect';

function collector() {
  return collect({ win: window, hot: { send() {}, on() {} }, onStatus() {} });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Collector.measure', () => {
  it('measures closed when the annotations hold on the resolved element', () => {
    document.body.innerHTML = '<div id="box"></div>';
    const c = collector();
    const target = collectElement(document.getElementById('box')!);
    expect(
      c.measure!(document, target, [{ type: 'no-overlap', elements: ['self', 'parent'] }]),
    ).toBe('closed');
    c.dispose();
  });

  it('measures open when an annotation fails', () => {
    document.body.innerHTML = '<div id="box"></div>';
    const c = collector();
    const target = collectElement(document.getElementById('box')!);
    const gap = { type: 'gap' as const, a: 'self', b: 'parent', expected: 10, actual: 0 };
    expect(c.measure!(document, target, [gap])).toBe('open');
    c.dispose();
  });

  it('measures unchecked for arrow and box annotations or an element that no longer resolves', () => {
    document.body.innerHTML = '<div id="box"></div>';
    const c = collector();
    const target = collectElement(document.getElementById('box')!);
    expect(c.measure!(document, target, [{ type: 'arrow' }, { type: 'box' }])).toBe('unchecked');
    document.body.innerHTML = '';
    const gap = { type: 'gap' as const, a: 'self', b: 'parent', expected: 10, actual: 0 };
    expect(c.measure!(document, target, [gap])).toBe('unchecked');
    c.dispose();
  });
});
