// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { reresolve, type ResolveTarget } from './reresolve';
import type { Selector } from './selectors';

function setBody(html: string): void {
  document.body.innerHTML = html;
}

function target(selectors: Selector[], tag: string, text: string): ResolveTarget {
  return { selectors, tag, text };
}

describe('reresolve', () => {
  it('uses the first selector that still resolves', () => {
    setBody('<button id="submit-btn">Go</button>');
    const el = document.querySelector('button')!;
    const selectors: Selector[] = [
      { kind: 'testid', value: '[data-testid="missing"]' },
      { kind: 'id', value: '#submit-btn' },
      { kind: 'css', value: 'body > button' },
    ];

    const result = reresolve(document, target(selectors, 'button', 'Go'));

    expect(result?.element).toBe(el);
    expect(result?.via).toBe('id');
  });

  it('skips a selector that now matches two elements', () => {
    setBody('<div class="row">A</div><div class="row">B</div>');
    const selectors: Selector[] = [
      { kind: 'css', value: '.row' },
      { kind: 'css', value: 'body > div:nth-of-type(2)' },
    ];
    const el = document.querySelectorAll('div')[1]!;

    const result = reresolve(document, target(selectors, 'div', 'B'));

    expect(result?.element).toBe(el);
    expect(result?.via).toBe('css');
  });

  it('skips a stored selector that is not valid CSS', () => {
    setBody('<button id="submit-btn">Go</button>');
    const el = document.querySelector('button')!;
    const selectors: Selector[] = [
      { kind: 'css', value: '###not-valid[[[' },
      { kind: 'id', value: '#submit-btn' },
    ];

    const result = reresolve(document, target(selectors, 'button', 'Go'));

    expect(result?.element).toBe(el);
    expect(result?.via).toBe('id');
  });

  it('falls back to tag and text when no selector resolves', () => {
    setBody('<button>Save changes</button>');
    const el = document.querySelector('button')!;
    const selectors: Selector[] = [{ kind: 'id', value: '#missing' }];

    const result = reresolve(document, target(selectors, 'button', 'Save changes'));

    expect(result?.element).toBe(el);
    expect(result?.via).toBe('text');
  });

  it('returns null when neither a selector nor the text finds the element', () => {
    setBody('<div>Something else</div>');
    const selectors: Selector[] = [{ kind: 'id', value: '#missing' }];

    const result = reresolve(document, target(selectors, 'button', 'Save changes'));

    expect(result).toBeNull();
  });

  it('finds the re-rendered element after the subtree is replaced', () => {
    setBody('<div id="parent"><button>Save changes</button></div>');
    const parent = document.getElementById('parent') as Element;
    const original = parent.querySelector('button');
    parent.innerHTML = '<button>Save changes</button>';
    const selectors: Selector[] = [{ kind: 'id', value: '#missing' }];

    const result = reresolve(document, target(selectors, 'button', 'Save changes'));

    expect(result?.element).not.toBe(original);
    expect(result?.element).toBe(parent.querySelector('button'));
    expect(result?.via).toBe('text');
  });

  it('reports which step found the element', () => {
    setBody('<button data-testid="save-btn">Save</button>');
    const el = document.querySelector('button')!;
    const selectors: Selector[] = [{ kind: 'testid', value: '[data-testid="save-btn"]' }];

    const result = reresolve(document, target(selectors, 'button', 'Save'));

    expect(result).toEqual({ element: el, via: 'testid' });
  });
});
