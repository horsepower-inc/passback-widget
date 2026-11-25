// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { resolveSelector, selectorChain } from './selectors';

function css(el: Element): string {
  const sel = selectorChain(el).find((s) => s.kind === 'css');
  if (!sel) throw new Error('no css selector');
  return sel.value;
}

function expectResolves(el: Element): string {
  const value = css(el);
  expect(document.querySelector(value)).toBe(el);
  expect(document.querySelectorAll(value)).toHaveLength(1);
  return value;
}

describe('stable css selectors', () => {
  it('keeps a marked element identifiable after sibling insertion', () => {
    document.body.innerHTML = '<ul><li>a</li><li class="hit">b</li><li>c</li></ul>';
    const target = document.querySelector('.hit')!;
    const value = expectResolves(target);
    expect(value).not.toContain('nth-');

    const ul = document.querySelector('ul')!;
    ul.insertBefore(document.createElement('li'), ul.firstChild);
    ul.appendChild(ul.firstElementChild!);
    expect(resolveSelector(document, { kind: 'css', value })).toBe(target);
  });

  it('uses target identity before ancestor identity', () => {
    document.body.innerHTML =
      '<section class="wrap"><button id="go" class="btn primary" data-testid="t">x</button></section>';
    const target = document.querySelector('button')!;
    const chain = selectorChain(target);
    expect(chain.map((s) => s.kind)).toEqual(['testid', 'id', 'role', 'css']);
    expect(chain[3]!.value).toBe('button#go.btn.primary');
    document.body.innerHTML = '<section class="wrap"><p class="x y">x</p></section><p>z</p>';
    expect(css(document.querySelector('.x')!)).toBe('p.x.y');
  });

  it('uses the nearest sufficient stable ancestor', () => {
    document.body.innerHTML =
      '<div id="outer"><div class="mid"><i></i></div><div class="other"><i></i></div></div><div class="mid"><i></i></div>';
    const target = document.querySelector('#outer .mid i')!;
    expect(expectResolves(target)).toBe('div#outer div.mid i');
    const inner = document.querySelector('.other i')!;
    expect(expectResolves(inner)).toBe('div.other i');

    document.body.innerHTML =
      '<div data-testid="card"><b></b></div><div data-testid="card"><b></b></div><div class="c1"><div data-testid="card"><b></b></div></div>';
    const b = document.querySelectorAll('b')[2]!;
    expect(expectResolves(b)).toContain('c1');

    document.body.innerHTML =
      '<div data-testid="solo"><span class="s"><b></b></span><span><b></b></span></div>';
    expect(expectResolves(document.querySelector('.s b')!)).toBe('span.s b');
    document.body.innerHTML =
      '<div data-testid="solo"><b><i></i></b></div><div><b><i></i></b></div>';
    const plain = document.querySelector('i')!;
    expect(expectResolves(plain)).toContain('data-testid="solo"');
  });

  it('excludes generated tokens and escapes stable tokens', () => {
    document.body.innerHTML =
      '<div id="sc-abc" class="sc-x css-1a _btn_1x2y3 w-[10px]"><p class="px-4 button-primary -  md:flex"></p><p></p></div>';
    const p = document.querySelector('p')!;
    const value = expectResolves(p);
    expect(value).toBe('p.px-4.button-primary.\\-.md\\:flex');
    for (const bad of ['sc-', 'css-', '_btn', '[']) expect(value).not.toContain(bad);
    const div = document.querySelector('div')!;
    expect(expectResolves(div)).toBe('div');
    expect(css(p)).toBe(value);
    expect(css(document.body)).toBe('body');
    expect(css(document.documentElement)).toBe('html');
  });

  it('resolves ambiguous identities before using positional fallback', () => {
    document.body.innerHTML =
      '<div class="a" data-testid="dup"><b class="k"></b></div><div class="b" data-testid="dup"><b class="k"></b></div>';
    const target = document.querySelectorAll('b')[1]!;
    const value = expectResolves(target);
    expect(value).not.toContain('nth-');

    document.body.innerHTML =
      '<div class="card" data-testid="line&#10;break"><b></b></div><div><b></b></div>';
    const lined = document.querySelectorAll('b')[0]!;
    const linedValue = expectResolves(lined);
    expect(linedValue).not.toContain('nth-');
    expect(linedValue).toContain('.card');
    expect(linedValue).not.toMatch(/[\n\r\f]/);

    document.body.innerHTML = '<p><i></i><i></i><i></i></p>';
    for (const el of Array.from(document.querySelectorAll('i'))) expectResolves(el);

    document.head.innerHTML = '<meta name="a"><meta name="b">';
    for (const el of Array.from(document.head.querySelectorAll('meta'))) expectResolves(el);
    document.head.innerHTML = '';
  });

  it('falls back to position past two descendant ancestor identities', () => {
    const chains = [
      ['a', 'b', 'c'],
      ['a', 'b', 'x'],
      ['a', 'x', 'c'],
      ['x', 'b', 'c'],
    ];
    for (const [one, two, three] of chains) {
      document.body.innerHTML = `<div class="${one}"><div class="${two}"><div class="${three}"><b></b></div></div></div><div class="a"><div class="b"><div class="c"><b></b></div></div></div>`;
      for (const el of Array.from(document.querySelectorAll('b'))) expectResolves(el);
    }
    document.body.innerHTML =
      '<div class="a"><div class="b"><b></b></div></div><div class="a"><span><div class="b"><b></b></div></span></div>';
    for (const el of Array.from(document.querySelectorAll('b'))) expectResolves(el);
  });
});
