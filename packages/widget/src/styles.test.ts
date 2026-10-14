// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { CLASS, installStyles, styleSheet } from './styles';
import { SCHEMES, TOKENS } from './tokens';

afterEach(() => {
  document.body.innerHTML = '';
});

function hostBlock(css: string): string {
  const match = css.match(/:host\s*\{([^}]*)\}/);
  const block = match?.[1];
  if (block === undefined) throw new Error('no :host block found');
  return block;
}

function selectorOk(selector: string): boolean {
  const trimmed = selector.trim();
  return (
    trimmed.startsWith(':host') ||
    trimmed.startsWith('.pb-') ||
    trimmed === 'from' ||
    trimmed === 'to' ||
    /^\d+%$/.test(trimmed)
  );
}

describe('styles', () => {
  it('declares every token on :host', () => {
    const css = styleSheet();
    const block = hostBlock(css);
    for (const name of [...Object.keys(TOKENS), ...Object.keys(SCHEMES.dark)]) {
      expect(block).toContain(`${name}:`);
    }
    expect(block).toContain('position: fixed');
    expect(block).toContain('inset: 0');
    expect(block).toContain('pointer-events: none');
    expect(block).toContain('z-index: var(--pb-z)');
  });

  it('uses no colour literal outside the token blocks', () => {
    const css = styleSheet();
    const withoutHost = css.replace(/:host[^{]*\{[^}]*\}/g, '');
    expect(withoutHost).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(withoutHost).not.toMatch(/rgb\(/);
    expect(withoutHost).not.toMatch(/hsl\(/);
  });

  it('sets no transition under prefers-reduced-motion', () => {
    const css = styleSheet();
    const index = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(index).toBeGreaterThan(-1);
    const block = css.slice(index);
    expect(block).toContain('transition: none');
    expect(block).toContain('animation: none');
    for (const cls of Object.values(CLASS)) {
      expect(block).toMatch(new RegExp(`\\.${cls}\\b`));
    }
  });

  it('styles every class name in CLASS', () => {
    const css = styleSheet();
    for (const cls of Object.values(CLASS)) {
      expect(css).toMatch(new RegExp(`\\.${cls}\\s*[,{:]`));
    }
  });

  it('targets nothing outside the shadow root', () => {
    const css = styleSheet();
    const selectorGroups = [...css.matchAll(/([^{}]+)\{/g)]
      .map((m) => (m[1] ?? '').trim())
      .filter((s) => !s.startsWith('@'));
    expect(selectorGroups.length).toBeGreaterThan(0);
    for (const group of selectorGroups) {
      for (const selector of group.split(',')) {
        expect(selectorOk(selector)).toBe(true);
      }
    }
  });

  it('lets a keyframe step be a percentage and still refuses a selector from outside the widget', () => {
    for (const ok of ['0%', '12%', '80%', '100%', 'from', 'to', '.pb-dot', ':host']) {
      expect(selectorOk(ok)).toBe(true);
    }
    for (const bad of ['body', 'div.pb-dot', '50', '%', '12% body', '']) {
      expect(selectorOk(bad)).toBe(false);
    }
  });

  it('carries the style kit names and no others', () => {
    expect(Object.keys(TOKENS)).toEqual([
      '--pb-radius-box',
      '--pb-radius-control',
      '--pb-radius-pin',
      '--pb-size-launcher',
      '--pb-size-pin',
      '--pb-size-box',
      '--pb-space-gap',
      '--pb-space-pad',
      '--pb-font-body',
      '--pb-font-small',
      '--pb-shadow-box',
      '--pb-motion-duration',
      '--pb-motion-ease',
      '--pb-motion-fly',
      '--pb-motion-spin',
      '--pb-motion-stamp',
      '--pb-opacity-idle',
      '--pb-z',
    ]);
    const colours = [
      '--pb-color-surface',
      '--pb-color-field',
      '--pb-color-text',
      '--pb-color-text-muted',
      '--pb-color-border',
      '--pb-color-main',
      '--pb-color-accent',
      '--pb-color-ink',
      '--pb-color-on-main',
      '--pb-color-halo',
      '--pb-color-ok',
      '--pb-color-bad',
      '--pb-color-ask',
      '--pb-color-on-status',
      '--pb-color-glow',
      '--pb-color-flame',
    ];
    expect(Object.keys(SCHEMES.light)).toEqual(colours);
    expect(Object.keys(SCHEMES.dark)).toEqual(colours);
  });

  it('gives every colour its light and its dark value', () => {
    expect(SCHEMES.light).toEqual({
      '--pb-color-surface': '#ffffff',
      '--pb-color-field': '#f3f4f6',
      '--pb-color-text': '#17181c',
      '--pb-color-text-muted': '#62656d',
      '--pb-color-border': '#e1e3e7',
      '--pb-color-main': '#17181c',
      '--pb-color-accent': '#7c9dff',
      '--pb-color-ink': '#e5261f',
      '--pb-color-on-main': '#ffffff',
      '--pb-color-halo': 'rgba(255,255,255,.85)',
      '--pb-color-ok': '#1f7a43',
      '--pb-color-bad': '#c0352b',
      '--pb-color-ask': '#9a5b00',
      '--pb-color-on-status': '#ffffff',
      '--pb-color-glow': '#ffd400',
      '--pb-color-flame': '#ff7a00',
    });
    expect(SCHEMES.dark).toEqual({
      '--pb-color-surface': '#17181c',
      '--pb-color-field': '#24262c',
      '--pb-color-text': '#f4f4f5',
      '--pb-color-text-muted': '#a3a6ad',
      '--pb-color-border': '#33363d',
      '--pb-color-main': '#f4f4f5',
      '--pb-color-accent': '#2f6bff',
      '--pb-color-ink': '#e5261f',
      '--pb-color-on-main': '#17181c',
      '--pb-color-halo': 'rgba(0,0,0,.7)',
      '--pb-color-ok': '#5fd08a',
      '--pb-color-bad': '#ff7a70',
      '--pb-color-ask': '#ffb84d',
      '--pb-color-on-status': '#17181c',
      '--pb-color-glow': '#ffd400',
      '--pb-color-flame': '#ff7a00',
    });
  });

  it('R4b declares glow and flame in both host themes', () => {
    for (const [name, v] of Object.entries({ glow: '#ffd400', flame: '#ff7a00' }))
      expect(styleSheet().split(`--pb-color-${name}: ${v};`)).toHaveLength(3);
  });

  it('shows the dark scheme by default and the light one by the host attribute', () => {
    const css = styleSheet();
    expect(hostBlock(css)).toContain('--pb-color-surface: #17181c;');
    const light = css.match(/:host\(\[data-pb-scheme="light"\]\)\s*\{([^}]*)\}/)?.[1];
    expect(light).toBeDefined();
    expect(light).toContain('--pb-color-surface: #ffffff;');
    for (const name of Object.keys(SCHEMES.light)) {
      expect(light).toContain(`${name}:`);
    }
  });

  it('references only custom properties the host declares', () => {
    const declared = new Set([...Object.keys(TOKENS), ...Object.keys(SCHEMES.dark)]);
    const used = [...styleSheet().matchAll(/var\((--pb-[a-z-]+)\)/g)].map((m) => m[1] ?? '');
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) {
      expect(declared.has(name)).toBe(true);
    }
  });

  it('declares no custom property outside the style kit', () => {
    const css = styleSheet();
    const light = css.match(/:host\(\[data-pb-scheme="light"\]\)\s*\{([^}]*)\}/)?.[1] ?? '';
    const declared = new Set([...Object.keys(TOKENS), ...Object.keys(SCHEMES.dark)]);
    const found = [...(hostBlock(css) + light).matchAll(/(--pb-[a-z-]+)\s*:/g)].map((m) => m[1] ?? '');
    expect(found.length).toBeGreaterThan(0);
    for (const name of found) {
      expect(declared.has(name)).toBe(true);
    }
  });

  it('installs one style element and is idempotent', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });

    const first = installStyles(root, document);
    expect(root.querySelectorAll('style').length).toBe(1);
    expect(first.textContent).toBe(styleSheet());

    const second = installStyles(root, document);
    expect(second).toBe(first);
    expect(root.querySelectorAll('style').length).toBe(1);
  });
});
