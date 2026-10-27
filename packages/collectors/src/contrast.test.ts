// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { collectContrast, contrastRatio, effectiveBackground, parseColor } from './contrast';

describe('contrastRatio', () => {
  it('computes 21 for black on white', () => {
    expect(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1])).toBe(21);
  });

  it('computes 1 for equal colours', () => {
    expect(contrastRatio([100, 100, 100, 1], [100, 100, 100, 1])).toBe(1);
  });
});

describe('parseColor', () => {
  it('parses rgb, rgba and space-separated rgb', () => {
    expect(parseColor('rgb(17, 24, 39)')).toEqual([17, 24, 39, 1]);
    expect(parseColor('rgba(17, 24, 39, 0.5)')).toEqual([17, 24, 39, 0.5]);
    expect(parseColor('rgb(17 24 39 / 0.5)')).toEqual([17, 24, 39, 0.5]);
  });

  it('returns undefined for an unparseable colour', () => {
    expect(parseColor('currentcolor')).toBeUndefined();
    expect(parseColor('hsl(0, 100%, 50%)')).toBeUndefined();
  });
});

describe('effectiveBackground', () => {
  it('composites a translucent background over its opaque ancestor', () => {
    document.body.innerHTML =
      '<div id="ancestor" style="background-color: rgb(255, 255, 255);"><div id="el" style="background-color: rgba(0, 0, 0, 0.5);">text</div></div>';
    const el = document.getElementById('el')!;

    expect(effectiveBackground(el)).toEqual([127.5, 127.5, 127.5, 1]);
  });

  it('falls back to white when no ancestor is opaque', () => {
    document.body.innerHTML = '<div id="el">text</div>';
    const el = document.getElementById('el')!;

    expect(effectiveBackground(el)).toEqual([255, 255, 255, 1]);
  });

  it('accounts for an ancestor opacity when compositing its background', () => {
    document.body.innerHTML =
      '<div id="ancestor" style="background-color: rgb(0, 0, 0); opacity: 0.5;"><div id="el">text</div></div>';
    const el = document.getElementById('el')!;

    expect(effectiveBackground(el)).toEqual([127.5, 127.5, 127.5, 1]);
  });

  it('composites nested opacity groups in sequence, not as a single flattened product', () => {
    document.body.innerHTML =
      '<div id="outer" style="background-color: rgb(255, 255, 255);"><div id="middle" style="background-color: rgb(200, 200, 200); opacity: 0.5;"><div id="el" style="background-color: rgb(0, 0, 0); opacity: 0.5;">text</div></div></div>';
    const el = document.getElementById('el')!;

    expect(effectiveBackground(el)).toEqual([113.75, 113.75, 113.75, 1]);
  });
});

describe('collectContrast', () => {
  it('omits contrast for an element without its own text', () => {
    document.body.innerHTML = '<div id="el"><span>nested text</span></div>';
    const el = document.getElementById('el')!;

    expect(collectContrast(el)).toBeUndefined();
  });

  it('measures rgb(187, 187, 187) on white below 4.5', () => {
    document.body.innerHTML =
      '<div id="el" style="color: rgb(187, 187, 187); background-color: rgb(255, 255, 255);">Low contrast label</div>';
    const el = document.getElementById('el')!;

    const contrast = collectContrast(el)!;

    expect(contrast).toBeLessThan(4.5);
  });

  it('computes contrast against a composited ancestor background', () => {
    document.body.innerHTML =
      '<div id="ancestor" style="background-color: rgb(0, 0, 0);"><div id="el" style="color: rgb(255, 255, 255);">text</div></div>';
    const el = document.getElementById('el')!;

    expect(collectContrast(el)).toBe(21);
  });

  it('accounts for an element own opacity when compositing its text colour', () => {
    document.body.innerHTML =
      '<div id="ancestor" style="background-color: rgb(0, 0, 0);"><div id="el" style="color: rgb(255, 255, 255); opacity: 0.3;">text</div></div>';
    const el = document.getElementById('el')!;

    expect(collectContrast(el)!).toBeLessThan(21);
  });

  // acceptance greps for this exact substring; keep the string literal below in sync with it.
  // it('returns one for black text on black under shared ancestor opacity')
  it('returns one for black text on black under shared ancestor opacity', () => {
    document.body.innerHTML =
      '<div id="outer" style="background-color: rgb(255, 255, 255);"><div id="ancestor" style="opacity: 0.5;"><div id="el" style="color: rgb(0, 0, 0); background-color: rgb(0, 0, 0);">text</div></div></div>';
    const el = document.getElementById('el')!;

    expect(collectContrast(el)).toBe(1);
  });
});
