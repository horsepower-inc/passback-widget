// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createOutline } from './dot-view';
import { CLASS, styleSheet } from './styles';

afterEach(() => {
  document.body.innerHTML = '';
});

function shadowRoot(corner?: string): ShadowRoot {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  if (corner !== undefined) {
    const launcher = document.createElement('div');
    launcher.className = 'pb-launcher';
    launcher.setAttribute('data-corner', corner);
    root.appendChild(launcher);
  }
  return root;
}

function hintCorner(root: ShadowRoot): string | null {
  createOutline(root);
  return root.querySelector('[part="hint"]')?.getAttribute('data-corner') ?? null;
}

function ruleBody(selector: string): string {
  const css = styleSheet().replace(/\s+/g, ' ');
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('hint corner', () => {
  it('puts the hint on the bottom edge when the launcher sits in a top corner', () => {
    expect(hintCorner(shadowRoot('top-left'))).toBe('top-left');
    expect(hintCorner(shadowRoot('top-right'))).toBe('top-right');
  });

  it('keeps the hint on the top edge when the launcher sits in a bottom corner', () => {
    expect(hintCorner(shadowRoot('bottom-left'))).toBe('bottom-left');
    expect(hintCorner(shadowRoot())).toBe('bottom-right');
  });

  it('styles a top-corner hint at the bottom edge and leaves the base rule at the top', () => {
    expect(ruleBody(`.${CLASS.hint}[data-corner^='top']`)).toContain('bottom: 10px');
    expect(ruleBody(`.${CLASS.hint}`)).toContain('top: 10px');
  });
});
