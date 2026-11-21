// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Element as ElementSchema } from '@passback/schema';
import { ATTR_ALLOWLIST, OUTER_HTML_MAX, TEXT_MAX, collectElement } from './element';
import { MASK_ATTR } from './mask';

describe('collectElement', () => {
  it('keeps only allowlisted attributes', () => {
    document.body.innerHTML =
      '<div id="a" class="b" data-testid="c" data-foo="d" style="color:red">x</div>';
    const el = document.querySelector('div')!;

    const data = collectElement(el);

    expect(data.attrs).toEqual({ id: 'a', class: 'b', 'data-testid': 'c' });
    expect(
      Object.keys(data.attrs).every((k) => (ATTR_ALLOWLIST as readonly string[]).includes(k)),
    ).toBe(true);
  });

  it('trims text to 200 characters with whitespace collapsed', () => {
    const el = document.createElement('div');
    el.textContent = `  ${'word '.repeat(60)}  `;
    document.body.innerHTML = '';
    document.body.appendChild(el);

    const data = collectElement(el);

    expect(data.text.length).toBe(TEXT_MAX);
    expect(data.text).not.toMatch(/\s{2,}/);
  });

  it('trims outerHTML to 2048 characters', () => {
    const el = document.createElement('div');
    el.setAttribute('data-x', 'y'.repeat(3000));
    document.body.innerHTML = '';
    document.body.appendChild(el);

    const data = collectElement(el);

    expect(data.outerHTML.length).toBe(OUTER_HTML_MAX);
  });

  it('never copies a typed input value', () => {
    const input = document.createElement('input');
    input.value = 'hunter2';
    document.body.innerHTML = '';
    document.body.appendChild(input);

    const data = collectElement(input);

    expect(JSON.stringify(data)).not.toContain('hunter2');
  });

  it('lowercases the tag name', () => {
    const el = document.createElement('DIV');
    document.body.innerHTML = '';
    document.body.appendChild(el);

    const data = collectElement(el);

    expect(data.tag).toBe('div');
  });

  it('validates against the schema Element', () => {
    document.body.innerHTML = '<button id="ok-btn" data-testid="btn" aria-label="Go">Go</button>';
    const el = document.querySelector('button')!;

    const data = collectElement(el);

    expect(() => ElementSchema.parse(data)).not.toThrow();
  });

  it('never copies text inside a descendant textarea', () => {
    document.body.innerHTML = '<div><textarea>secret</textarea></div>';
    const el = document.querySelector('div')!;

    const data = collectElement(el);

    expect(JSON.stringify(data)).not.toContain('secret');
  });

  it('strips form values before trimming outerHTML', () => {
    const div = document.createElement('div');
    const input = document.createElement('input');
    input.setAttribute('value', 'x'.repeat(3000));
    div.appendChild(document.createTextNode('a'.repeat(2000)));
    div.appendChild(input);
    document.body.innerHTML = '';
    document.body.appendChild(div);

    const data = collectElement(div);

    expect(data.outerHTML).not.toContain('xxxxxxxxxx');
  });

  it('strips form values inside template content', () => {
    document.body.innerHTML = '<div><template><input value="secret"></template></div>';
    const el = document.querySelector('div')!;

    const data = collectElement(el);

    expect(data.outerHTML).not.toContain('secret');
  });

  it('strips form values when the element itself is a template', () => {
    document.body.innerHTML =
      '<template><input value="secret-6"><textarea>secret-7</textarea><select><option value="secret-8">secret-9</option></select></template>';
    const el = document.querySelector('template')!;

    const data = collectElement(el);

    expect(data.outerHTML).not.toMatch(/secret-/);
  });

  it('never copies text typed into a descendant contenteditable element', () => {
    document.body.innerHTML = '<div><div contenteditable="true">typed-secret-1</div></div>';

    const data = collectElement(document.querySelector('div')!);

    expect(data.text).not.toContain('typed-secret-1');
    expect(data.outerHTML).not.toContain('typed-secret-1');
    expect(data.outerHTML).toContain('contenteditable');
  });

  it('never copies text typed into a descendant role=textbox element', () => {
    document.body.innerHTML = '<div><div role="textbox">typed-secret-2</div></div>';

    const data = collectElement(document.querySelector('div')!);

    expect(data.text).not.toContain('typed-secret-2');
    expect(data.outerHTML).not.toContain('typed-secret-2');
    expect(data.outerHTML).toContain('role="textbox"');
  });

  it('empties the text of a pinned contenteditable element and keeps its tag and attrs', () => {
    document.body.innerHTML =
      '<section id="ed" contenteditable="true" aria-label="Comment">typed-secret-3</section>';

    const data = collectElement(document.querySelector('section')!);

    expect(data.tag).toBe('section');
    expect(data.attrs.id).toBe('ed');
    expect(data.attrs['aria-label']).toBe('Comment');
    expect(data.text).toBe('');
    expect(data.outerHTML).not.toContain('typed-secret-3');
  });

  it('empties the text of an element pinned inside a contenteditable host', () => {
    document.body.innerHTML = '<div contenteditable="true"><p id="para">typed-secret-4</p></div>';

    const data = collectElement(document.querySelector('#para')!);

    expect(data.tag).toBe('p');
    expect(data.attrs.id).toBe('para');
    expect(data.text).toBe('');
    expect(data.outerHTML).not.toContain('typed-secret-4');
  });

  it('keeps the text of content marked contenteditable false outside an editable host', () => {
    document.body.innerHTML = '<div contenteditable="false">kept-text</div>';

    const data = collectElement(document.querySelector('div')!);

    expect(data.text).toBe('kept-text');
    expect(data.outerHTML).toContain('kept-text');
  });

  it('never copies contenteditable text held inside a template', () => {
    document.body.innerHTML =
      '<div><template><div contenteditable="true">typed-secret-5</div></template></div>';

    const data = collectElement(document.querySelector('div')!);

    expect(data.outerHTML).not.toContain('typed-secret-5');
  });

  it('leaves the live template content untouched', () => {
    document.body.innerHTML = '<template><input value="keep-me"></template>';
    const t = document.querySelector('template')!;

    collectElement(t);

    expect(t.content.querySelector('input')!.getAttribute('value')).toBe('keep-me');
  });

  it('masks the text and outerHTML of an element inside data-passback-mask', () => {
    document.body.innerHTML = `<div ${MASK_ATTR}><span id="target">Jane Doe</span></div>`;
    const el = document.querySelector('#target')!;

    const data = collectElement(el);

    expect(data.text).toBe('•••• •••');
    expect(data.outerHTML).not.toContain('Jane');
    expect(data.outerHTML).not.toContain('Doe');
  });

  it('masks only the marked descendant when the element itself is not masked', () => {
    document.body.innerHTML = `<div id="target"><span>keep</span><b ${MASK_ATTR}>secret</b></div>`;
    const el = document.querySelector('#target')!;

    const data = collectElement(el);

    expect(data.text).toContain('keep');
    expect(data.text).not.toContain('secret');
    expect(data.outerHTML).not.toContain('secret');
  });

  it('masks alt, title, placeholder and aria-label under a masked element', () => {
    document.body.innerHTML = `<div ${MASK_ATTR}><div id="target" alt="Jane" title="Doe" placeholder="Smith" aria-label="Card"></div></div>`;
    const el = document.querySelector('#target')!;

    const data = collectElement(el);

    expect(data.attrs.alt).toBe('••••');
    expect(data.attrs.title).toBe('•••');
    expect(data.attrs.placeholder).toBe('•••••');
    expect(data.attrs['aria-label']).toBe('••••');
  });

  it('redacts a secret query value in the href of a marked link, in attrs and in outerHTML', () => {
    document.body.innerHTML =
      '<a id="l" href="/reset?token=abc123&amp;next=%2Fhome#frag">Reset</a>';
    const data = collectElement(document.querySelector('a')!);

    expect(data.attrs.href).toBe('/reset?token=%5Bredacted%5D&next=%2Fhome');
    expect(data.outerHTML).not.toContain('abc123');
    expect(data.outerHTML).toContain('token=%5Bredacted%5D');
    expect(data.outerHTML).not.toContain('frag');
    const abs = document.createElement('a');
    abs.setAttribute('href', '//example.com/x?api_key=abc123');
    expect(collectElement(abs).attrs.href).toBe('//example.com/x?api_key=%5Bredacted%5D');
  });

  it('redacts secret query values in the address attributes of descendants and of template content', () => {
    const q = '?token=abc123';
    document.body.innerHTML = `<div id="r"><img src="/a.png${q}" srcset="/a.png${q} 1x, /b.png${q} 2x"><form action="/go${q}"><button formaction="/f${q}">x</button></form><video poster="/p.png${q}"></video><object data="/o${q}"></object><template><a href="https://example.com/t${q}">t</a><template><a href="/n${q}">n</a></template></template></div>`;
    const root = document.querySelector('#r')!;

    const html = collectElement(root).outerHTML;
    expect(html).not.toContain('abc123');
    expect(html).toContain('srcset=');

    const tpl = document.createElement('template');
    tpl.innerHTML = `<a href="/z${q}">z</a>`;
    expect(collectElement(tpl).outerHTML).not.toContain('abc123');

    const long = document.createElement('div');
    long.innerHTML = `<p>${'x'.repeat(OUTER_HTML_MAX)}</p><a href="/late${q}">l</a>`;
    expect(collectElement(long).outerHTML).not.toContain('abc123');
  });

  it('keeps an address without a secret as written and never changes the live element', () => {
    document.body.innerHTML =
      '<div id="r"><a id="p" href="/plain?page=2&amp;q=a%20b">p</a><a id="s" href="/x?token=abc123">s</a></div>';
    const plain = document.querySelector('#p')!;
    expect(collectElement(plain).attrs.href).toBe('/plain?page=2&q=a%20b');
    expect(collectElement(plain).outerHTML).toContain('href="/plain?page=2&amp;q=a%20b"');

    const root = document.querySelector('#r')!;
    const first = collectElement(root);
    const second = collectElement(root);
    expect(second).toEqual(first);
    expect(document.querySelector('#s')!.getAttribute('href')).toBe('/x?token=abc123');
  });
});
