// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { MASK_ATTR, MASK_CHAR, isEditable, isMasked, maskText } from './mask';

describe('mask', () => {
  it('maskText replaces each non-space character and keeps whitespace', () => {
    const input = 'ab cd\n1e';

    const result = maskText(input);

    expect(result).toBe(
      `${MASK_CHAR}${MASK_CHAR} ${MASK_CHAR}${MASK_CHAR}\n${MASK_CHAR}${MASK_CHAR}`,
    );
    expect(result.length).toBe(input.length);
  });

  it('isMasked is true for the element and for a descendant of it', () => {
    document.body.innerHTML = `<div ${MASK_ATTR}><span id="child">x</span></div>`;
    const parent = document.querySelector('div')!;
    const child = document.querySelector('#child')!;

    expect(isMasked(parent)).toBe(true);
    expect(isMasked(child)).toBe(true);
  });

  it('isEditable is true for a contenteditable host, a descendant of it and a role=textbox element', () => {
    document.body.innerHTML =
      '<div contenteditable="true" id="host"><p id="child">x</p></div><div role="textbox" id="box">y</div>';

    expect(isEditable(document.querySelector('#host')!)).toBe(true);
    expect(isEditable(document.querySelector('#child')!)).toBe(true);
    expect(isEditable(document.querySelector('#box')!)).toBe(true);
  });

  it('isEditable is false for contenteditable false and for a plain element', () => {
    document.body.innerHTML =
      '<div contenteditable="false" id="off">x</div><p id="plain">y</p>';

    expect(isEditable(document.querySelector('#off')!)).toBe(false);
    expect(isEditable(document.querySelector('#plain')!)).toBe(false);
  });

  it('isMasked is false for an element outside any masked one', () => {
    document.body.innerHTML = `<div ${MASK_ATTR}></div><span id="outside">x</span>`;
    const outside = document.querySelector('#outside')!;

    expect(isMasked(outside)).toBe(false);
  });
});
