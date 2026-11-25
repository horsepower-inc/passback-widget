// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Element as ElementSchema } from '@passback/schema';
import { collectElement } from './element';
import { MASK_ATTR } from './mask';

// Throw only while the path is being captured, so the other collectors still run.
const inPathCapture = (): boolean => /collectPath|pathSegment/.test(new Error().stack ?? '');

describe('collectElement path', () => {
  it('captures a framework-free DOM path from ancestors to the marked element', () => {
    document.body.innerHTML = '<main><section><button>Go</button></section></main>';
    const data = collectElement(document.querySelector('button')!);
    expect(data.path).toEqual(['html', 'body', 'main', 'section', 'button']);
    expect(ElementSchema.safeParse(data).success).toBe(true);
  });

  it('chooses the most stable nonempty identifier for each path segment', () => {
    document.body.innerHTML = `
      <div data-testid="t" id="i" role="r" aria-label="a">
        <div id="i" role="r" aria-label="a">
          <div role="r" aria-label="a">
            <div aria-label="a"><div id="" role="" aria-label=""><p></p></div></div>
          </div>
        </div>
      </div>`;
    const data = collectElement(document.querySelector('p')!);
    expect(data.path!.slice(-6)).toEqual([
      'div[data-testid="t"]',
      'div#i',
      'div[role="r"]',
      'div[aria-label="a"]',
      'div',
      'p',
    ]);
  });

  it('keeps the nearest eight path segments in outermost-first order', () => {
    let html = '<span id="target"></span>';
    for (let i = 0; i < 10; i++) html = `<div id="d${i}">${html}</div>`;
    document.body.innerHTML = html;
    const data = collectElement(document.querySelector('#target')!);
    expect(data.path).toHaveLength(8);
    expect(data.path).toEqual([
      'div#d6',
      'div#d5',
      'div#d4',
      'div#d3',
      'div#d2',
      'div#d1',
      'div#d0',
      'span#target',
    ]);
  });

  it('captures detached and shallow targets without mutating the DOM', () => {
    document.body.innerHTML = '<p>x</p>';
    const detached = document.createElement('div');
    detached.id = 'solo';
    expect(collectElement(detached).path).toEqual(['div#solo']);
    const wrap = document.createElement('section');
    const inner = document.createElement('b');
    wrap.appendChild(inner);
    expect(collectElement(inner).path).toEqual(['section', 'b']);
    const before = document.documentElement.outerHTML;
    collectElement(document.querySelector('p')!);
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it('keeps path capture deterministic and preserves existing element fields', () => {
    document.body.innerHTML = '<div id="a"><button data-testid="b">Go</button></div>';
    const el = document.querySelector('button')!;
    const first = collectElement(el);
    const second = collectElement(el);
    expect(second).toEqual(first);
    expect(first.tag).toBe('button');
    expect(first.attrs).toEqual({ 'data-testid': 'b' });
    expect(first.text).toBe('Go');
    expect(first.selectors.length).toBeGreaterThan(0);
  });

  it('excludes classes text and form values from DOM paths', () => {
    document.body.innerHTML =
      '<div class="secret-class">hello-text<input value="typed-secret" class="c2"></div>';
    const data = collectElement(document.querySelector('input')!);
    const joined = data.path!.join('|');
    expect(joined).not.toContain('secret-class');
    expect(joined).not.toContain('hello-text');
    expect(joined).not.toContain('typed-secret');
    expect(joined).not.toContain('c2');
  });

  it('masks ancestor and target aria-labels in DOM paths', () => {
    document.body.innerHTML = `<div ${MASK_ATTR} aria-label="Jane"><span aria-label="Doe"></span></div><nav aria-label="Main"></nav>`;
    const data = collectElement(document.querySelector('span')!);
    expect(data.path!.slice(-2)).toEqual(['div[aria-label="••••"]', 'span[aria-label="•••"]']);
    expect(collectElement(document.querySelector('nav')!).path!.slice(-1)).toEqual([
      'nav[aria-label="Main"]',
    ]);
  });

  it('redacts a JWT in an identifier before the segment is cut, so no claims survive', () => {
    const claims =
      'eyJzdWIiOiJ1c2VyLTEyMyIsIm5hbWUiOiJTeW50aGV0aWMgVXNlciIsImV4cCI6MTk5OTk5OTk5OX0';
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${claims}.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU`;
    document.body.innerHTML = `<div aria-label="Token ${jwt}"><button>Go</button></div>`;
    const data = collectElement(document.querySelector('button')!);
    const segment = data.path!.at(-2)!;
    expect(segment.length).toBeLessThanOrEqual(120);
    expect(segment).not.toContain(claims.slice(0, 12));
    expect(segment).not.toContain('eyJ');
    expect(segment).toBe('div[aria-label="Token [redacted]"]');
    const long = `<div id="${'a'.repeat(200)}"><b></b></div>`;
    document.body.innerHTML = long;
    expect(collectElement(document.querySelector('b')!).path!.at(-2)).toHaveLength(120);
  });

  it('omits the path when ancestor access throws and preserves element collection', () => {
    document.body.innerHTML = '<div><button>Go</button></div>';
    const el = document.querySelector('button')!;
    const parent = el.parentNode as Element;
    Object.defineProperty(el, 'parentElement', {
      get() {
        if (inPathCapture()) throw new Error('boom');
        return parent;
      },
    });
    const data = collectElement(el);
    expect(data.path).toBeUndefined();
    expect('path' in data).toBe(false);
    expect(data.tag).toBe('button');
    expect(data.text).toBe('Go');
  });

  it('omits the path when an ancestor identifier read throws', () => {
    document.body.innerHTML = '<div id="x"><button>Go</button></div>';
    const parent = document.querySelector('div')!;
    const original = parent.getAttribute.bind(parent);
    parent.getAttribute = (name: string) => {
      if (inPathCapture()) throw new Error('boom');
      return original(name);
    };
    const data = collectElement(document.querySelector('button')!);
    expect(data.path).toBeUndefined();
    expect(data.tag).toBe('button');
  });
});
