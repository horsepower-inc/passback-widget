// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { resolveSelector, selectorChain, type Selector } from './selectors';

describe('selectorChain', () => {
  it('orders selectors testid, id, role, css', () => {
    document.body.innerHTML =
      '<button data-testid="btn" id="submit-btn" aria-label="Submit">Go</button>';
    const el = document.querySelector('button')!;

    const chain = selectorChain(el);

    expect(chain.map((s) => s.kind)).toEqual(['testid', 'id', 'role', 'css']);
  });

  it('omits a testid shared by two elements', () => {
    document.body.innerHTML = '<div data-testid="dup"></div><div data-testid="dup"></div>';
    const el = document.querySelectorAll('div')[0]!;

    const chain = selectorChain(el);

    expect(chain.find((s) => s.kind === 'testid')).toBeUndefined();
  });

  it('builds a role selector from aria-label before text', () => {
    document.body.innerHTML = '<button aria-label="Close">X</button>';
    const el = document.querySelector('button')!;

    const chain = selectorChain(el);

    expect(chain.find((s) => s.kind === 'role')?.value).toBe('role=button[name="Close"]');
  });

  it('omits the role selector when the accessible name is empty', () => {
    document.body.innerHTML = '<div role="note"></div>';
    const el = document.querySelector('div')!;

    const chain = selectorChain(el);

    expect(chain.find((s) => s.kind === 'role')).toBeUndefined();
  });

  it('always ends with a css path that resolves to the element', () => {
    document.body.innerHTML = '<div><span>Text</span></div>';
    const el = document.querySelector('span')!;

    const chain = selectorChain(el);
    const css = chain[chain.length - 1]!;

    expect(css.kind).toBe('css');
    expect(resolveSelector(document, css)).toBe(el);
  });

  it('escapes quotes in attribute values', () => {
    const el = document.createElement('div');
    el.setAttribute('data-testid', 'a"b\\c');
    document.body.innerHTML = '';
    document.body.appendChild(el);

    const chain = selectorChain(el);
    const testid = chain.find((s) => s.kind === 'testid')!;

    expect(testid.value).toBe('[data-testid="a\\"b\\\\c"]');
    expect(resolveSelector(document, testid)).toBe(el);
  });

  it('resolves every selector back to the same element', () => {
    document.body.innerHTML =
      '<div id="wrap"><button data-testid="x" id="ok-btn" aria-label="Click">Y</button></div>';
    const el = document.querySelector('button')!;

    const chain = selectorChain(el);

    for (const sel of chain) {
      expect(resolveSelector(document, sel)).toBe(el);
    }
  });

  it('resolves to the re-rendered element after the subtree is replaced', () => {
    document.body.innerHTML =
      '<div id="parent"><button data-testid="x" id="ok-btn" aria-label="Click">Y</button></div>';
    const parent = document.getElementById('parent')!;
    const el = parent.querySelector('button')!;

    const chain = selectorChain(el);
    const markup = parent.innerHTML;
    parent.innerHTML = markup;
    const newEl = parent.querySelector('button')!;

    expect(newEl).not.toBe(el);
    for (const sel of chain) {
      expect(resolveSelector(document, sel)).toBe(newEl);
    }
  });

  it('returns null for a selector that matches two elements', () => {
    document.body.innerHTML = '<div data-testid="dup"></div><div data-testid="dup"></div>';
    const sel: Selector = { kind: 'testid', value: '[data-testid="dup"]' };

    expect(resolveSelector(document, sel)).toBeNull();
  });

  it('builds a css selector for body and html', () => {
    const bodyChain = selectorChain(document.body);
    const bodyCss = bodyChain[bodyChain.length - 1]!;
    expect(bodyCss.value).toBe('body');
    expect(resolveSelector(document, bodyCss)).toBe(document.body);

    const htmlChain = selectorChain(document.documentElement);
    const htmlCss = htmlChain[htmlChain.length - 1]!;
    expect(htmlCss.value).toBe('html');
    expect(resolveSelector(document, htmlCss)).toBe(document.documentElement);
  });

  it('never puts descendant textarea text into a role selector', () => {
    document.body.innerHTML =
      '<div role="group"><label>Notes</label><textarea>secret</textarea></div>';
    const el = document.querySelector('div')!;

    const chain = selectorChain(el);

    expect(JSON.stringify(chain)).not.toContain('secret');
    const role = chain.find((s) => s.kind === 'role');
    expect(role?.value).toBe('role=group[name="Notes"]');
    expect(resolveSelector(document, role!)).toBe(el);
  });

  it('never uses a form control own text as its role name', () => {
    document.body.innerHTML = '<textarea role="textbox">secret</textarea>';
    const el = document.querySelector('textarea')!;

    let chain = selectorChain(el);
    expect(JSON.stringify(chain)).not.toContain('secret');
    expect(chain.find((s) => s.kind === 'role')).toBeUndefined();

    el.setAttribute('aria-label', 'Notes');
    chain = selectorChain(el);
    const role = chain.find((s) => s.kind === 'role');
    expect(role?.value).toBe('role=textbox[name="Notes"]');
    expect(resolveSelector(document, role!)).toBe(el);
  });

  it('never puts text typed into a descendant contenteditable element into a role selector', () => {
    document.body.innerHTML =
      '<div role="group"><label>Notes</label><div contenteditable="true">secret</div></div>';
    const el = document.querySelector('div')!;

    const chain = selectorChain(el);

    expect(JSON.stringify(chain)).not.toContain('secret');
    const role = chain.find((s) => s.kind === 'role');
    expect(role?.value).toBe('role=group[name="Notes"]');
    expect(resolveSelector(document, role!)).toBe(el);
  });

  it('never uses the typed text of a contenteditable element as its role name', () => {
    document.body.innerHTML = '<div role="textbox" contenteditable="true">secret</div>';
    const el = document.querySelector('div')!;

    let chain = selectorChain(el);
    expect(JSON.stringify(chain)).not.toContain('secret');
    expect(chain.find((s) => s.kind === 'role')).toBeUndefined();

    el.setAttribute('aria-label', 'Notes');
    chain = selectorChain(el);
    const role = chain.find((s) => s.kind === 'role');
    expect(role?.value).toBe('role=textbox[name="Notes"]');
    expect(resolveSelector(document, role!)).toBe(el);
  });

  it('never uses text inside a contenteditable host as the role name of an element in it', () => {
    document.body.innerHTML = '<div contenteditable="true"><h2>secret</h2></div>';
    const el = document.querySelector('h2')!;

    const chain = selectorChain(el);

    expect(JSON.stringify(chain)).not.toContain('secret');
    expect(chain.find((s) => s.kind === 'role')).toBeUndefined();
  });
});
