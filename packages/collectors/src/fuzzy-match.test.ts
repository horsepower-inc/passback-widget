// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { findByTagAndText, normalizeText, TEXT_MATCH_MAX } from './fuzzy-match';

function setBody(html: string): void {
  document.body.innerHTML = html;
}

describe('normalizeText', () => {
  it('collapses whitespace, trims, and caps at TEXT_MATCH_MAX characters', () => {
    expect(normalizeText('  a   b\n\tc  ')).toBe('a b c');
    expect(normalizeText('x'.repeat(TEXT_MATCH_MAX + 100))).toBe('x'.repeat(TEXT_MATCH_MAX));
  });
});

describe('findByTagAndText', () => {
  it('finds the one element with the same tag and text', () => {
    setBody('<div>Save changes</div><span>Save changes</span>');
    const found = findByTagAndText(document, 'div', 'Save changes');
    expect(found).toBe(document.querySelector('div'));
  });

  it('collapses whitespace before comparing', () => {
    setBody('<button>  Save   \n changes  </button>');
    const found = findByTagAndText(document, 'button', 'Save changes');
    expect(found).toBe(document.querySelector('button'));
  });

  it('compares only the first 200 characters', () => {
    const longText = 'a'.repeat(300);
    setBody(`<p>${longText}</p>`);
    const found = findByTagAndText(document, 'p', 'a'.repeat(200));
    expect(found).toBe(document.querySelector('p'));
  });

  it('returns null when two elements share the tag and text', () => {
    setBody('<div>Save changes</div><div>Save changes</div>');
    expect(findByTagAndText(document, 'div', 'Save changes')).toBeNull();
  });

  it('returns null when no element has that tag and text', () => {
    setBody('<div>Save changes</div>');
    expect(findByTagAndText(document, 'div', 'Discard changes')).toBeNull();
  });

  it('ignores an element with the same text but another tag', () => {
    setBody('<span>Save changes</span>');
    expect(findByTagAndText(document, 'div', 'Save changes')).toBeNull();
  });

  it('returns null for empty text', () => {
    setBody('<div>Save changes</div>');
    expect(findByTagAndText(document, 'div', '   ')).toBeNull();
  });

  it('returns null for a tag that is not a plain tag name', () => {
    setBody('<div><span>Save changes</span></div>');
    expect(findByTagAndText(document, 'div > span', 'Save changes')).toBeNull();
    expect(findByTagAndText(document, '*', 'Save changes')).toBeNull();
  });

  it('searches only inside the given root', () => {
    setBody('<div id="a"><span>Save changes</span></div><div id="b"></div>');
    const scopedRoot = document.getElementById('b') as Element;
    expect(findByTagAndText(scopedRoot, 'span', 'Save changes')).toBeNull();
  });

  it('finds the re-rendered element after the subtree is replaced', () => {
    setBody('<div id="parent"><button>Save changes</button></div>');
    const parent = document.getElementById('parent') as Element;
    const original = parent.querySelector('button');
    parent.innerHTML = '<button>Save changes</button>';
    const found = findByTagAndText(document, 'button', 'Save changes');
    expect(found).not.toBe(original);
    expect(found).toBe(parent.querySelector('button'));
  });
});
