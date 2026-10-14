// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTheme,
  contrast,
  customColors,
  inkOn,
  luminance,
  parseColor,
  readTheme,
  schemeFor,
} from './theme';

const WHITE = 'rgb(255, 255, 255)';
const BLACK = 'rgb(0, 0, 0)';
const CLEAR = 'rgba(0, 0, 0, 0)';

function fakeWin(body: string | Error, html: string | Error, doc: Document) {
  return {
    getComputedStyle: (el: Element) => {
      const value = el === doc.body ? body : html;
      if (value instanceof Error) throw value;
      return { backgroundColor: value } as CSSStyleDeclaration;
    },
  };
}

const SAMPLES = [
  ...Array.from({ length: 16 }, (_, i) => `#${(i * 17).toString(16).padStart(2, '0').repeat(3)}`),
  '#17181c',
  '#f4f4f5',
  '#2f6bff',
  '#7c9dff',
  '#e5261f',
  '#2563eb',
  '#0ea5e9',
  '#22c55e',
  '#f59e0b',
  '#ff0000',
  '#767676',
  '#777777',
  '#7a7a7a',
  '#6b7280',
];

function setAttr(name: string, value: string | null): void {
  document.head.querySelectorAll(`script[${name}]`).forEach((s) => s.remove());
  if (value === null) return;
  const script = document.createElement('script');
  script.setAttribute(name, value);
  document.head.append(script);
}

function hostWith(main: string | null, secondary: string | null, theme?: string): HTMLElement {
  setAttr('data-passback-main', main);
  setAttr('data-passback-secondary', secondary);
  if (theme) setTheme(theme);
  const host = document.createElement('div');
  applyTheme(host, document, fakeWin(WHITE, WHITE, document));
  return host;
}

function setTheme(value: string | null): void {
  document.head.querySelectorAll('script[data-passback-theme]').forEach((s) => s.remove());
  if (value === null) return;
  const script = document.createElement('script');
  script.setAttribute('data-passback-theme', value);
  document.head.append(script);
}

afterEach(() => {
  setTheme(null);
  setAttr('data-passback-main', null);
  setAttr('data-passback-secondary', null);
  document.body.innerHTML = '';
});

describe('theme', () => {
  it('parses hex, rgb and rgba colours in comma and space form', () => {
    expect(parseColor('#FF8000')).toEqual({ r: 255, g: 128, b: 0, a: 1 });
    expect(parseColor(' rgb(255, 255, 255) ')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('rgb(0 0 0 / 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgb(0 0 0 / 50%)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseColor('rgb(300, -4, 5)')).toEqual({ r: 255, g: 0, b: 5, a: 1 });
  });

  it('reads transparent and a zero alpha as fully transparent', () => {
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor(CLEAR)?.a).toBe(0);
  });

  it('returns undefined for a colour it cannot parse', () => {
    for (const text of ['', 'red', '#fff', 'hsl(0 0% 100%)', 'oklch(1 0 0)', 'rgb(a, b, c)']) {
      expect(parseColor(text)).toBeUndefined();
    }
  });

  it('computes the WCAG relative luminance', () => {
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 4);
    expect(luminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 4);
    expect(luminance(parseColor('#17181c')!)).toBeCloseTo(0.0092, 4);
    expect(luminance(parseColor('#808080')!)).toBeCloseTo(0.2159, 4);
  });

  it('gives a light page the dark scheme and a dark page the light scheme', () => {
    expect(schemeFor('auto', [WHITE])).toBe('dark');
    expect(schemeFor('auto', ['#17181c'])).toBe('light');
  });

  it('puts the boundary at a luminance of 0.4', () => {
    expect(schemeFor('auto', ['rgb(170, 170, 170)'])).toBe('dark');
    expect(schemeFor('auto', ['rgb(169, 169, 169)'])).toBe('light');
  });

  it('falls back from a transparent body to html and then to white', () => {
    expect(schemeFor('auto', [CLEAR, BLACK])).toBe('light');
    expect(schemeFor('auto', [CLEAR, 'transparent'])).toBe('dark');
    expect(schemeFor('auto', ['oklch(0 0 0)', ''])).toBe('dark');
    expect(schemeFor('auto', [])).toBe('dark');
  });

  it('lets a theme setting of light or dark override the page', () => {
    expect(schemeFor('light', [WHITE])).toBe('light');
    expect(schemeFor('dark', [BLACK])).toBe('dark');
    setTheme('Light');
    expect(readTheme(document)).toBe('light');
    setTheme('dark');
    expect(readTheme(document)).toBe('dark');
  });

  it('treats any other theme setting as auto', () => {
    expect(readTheme(document)).toBe('auto');
    setTheme('sepia');
    expect(readTheme(document)).toBe('auto');
    setTheme('');
    expect(readTheme(document)).toBe('auto');
  });

  it('sets data-pb-scheme on the host from the computed backgrounds', () => {
    const host = document.createElement('div');
    applyTheme(host, document, fakeWin(CLEAR, BLACK, document));
    expect(host.getAttribute('data-pb-scheme')).toBe('light');
    applyTheme(host, document, fakeWin(WHITE, BLACK, document));
    expect(host.getAttribute('data-pb-scheme')).toBe('dark');
    setTheme('light');
    applyTheme(host, document, fakeWin(WHITE, WHITE, document));
    expect(host.getAttribute('data-pb-scheme')).toBe('light');
  });

  it('uses white when getComputedStyle throws', () => {
    const host = document.createElement('div');
    applyTheme(host, document, fakeWin(new Error('x'), new Error('y'), document));
    expect(host.getAttribute('data-pb-scheme')).toBe('dark');
  });

  it('puts data-pb-scheme on the widget host when the widget starts', async () => {
    (window as unknown as { __passback?: unknown }).__passback = { autoStart: false };
    const { start } = await import('./index');
    const widget = start();
    const host = document.querySelector('[data-passback-host]');
    expect(['light', 'dark']).toContain(host?.getAttribute('data-pb-scheme'));
    widget.stop();
    delete (window as unknown as { __passback?: unknown }).__passback;
  });

  describe('custom colours', () => {
    const rgb = (hex: string) => parseColor(hex)!;

    it('computes the WCAG contrast ratio', () => {
      expect(contrast(rgb('#ffffff'), rgb('#000000'))).toBeCloseTo(21, 5);
      expect(contrast(rgb('#000000'), rgb('#ffffff'))).toBeCloseTo(21, 5);
      expect(contrast(rgb('#777777'), rgb('#777777'))).toBeCloseTo(1, 5);
    });

    it('picks white, #17181c or black so that text contrast is at least 4.5', () => {
      expect(inkOn('#2563eb')).toBe('#ffffff');
      expect(inkOn('#1e293b')).toBe('#ffffff');
      expect(inkOn('#f59e0b')).toBe('#17181c');
      expect(inkOn('#7c9dff')).toBe('#17181c');
      expect(inkOn('#808080')).toBe('#000000');
      expect(inkOn('#ff0000')).toBe('#000000');
      for (const c of SAMPLES) expect(contrast(rgb(inkOn(c)), rgb(c))).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps on-main readable on main and text readable on surface for every sample colour', () => {
      for (const c of SAMPLES) {
        const both = customColors(c, c);
        const only = customColors('', c);
        for (const [set, main, surface] of [
          [both, '--pb-color-main', '--pb-color-surface'],
          [only, '--pb-color-main', '--pb-color-surface'],
        ] as const) {
          const onMain = contrast(rgb(set['--pb-color-on-main']!), rgb(set[main]!));
          const text = contrast(rgb(set['--pb-color-text']!), rgb(set[surface]!));
          expect(onMain).toBeGreaterThanOrEqual(4.5);
          expect(text).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it('sets main, accent, on-main and halo from data-passback-main', () => {
      const style = hostWith('#2563EB', null).style;
      expect(style.getPropertyValue('--pb-color-main')).toBe('#2563eb');
      expect(style.getPropertyValue('--pb-color-accent')).toBe('#2563eb');
      expect(style.getPropertyValue('--pb-color-on-main')).toBe('#ffffff');
      expect(style.getPropertyValue('--pb-color-halo')).toBe('rgba(255,255,255,.85)');
      expect(customColors('#f59e0b', '')['--pb-color-halo']).toBe('rgba(0,0,0,.7)');
    });

    it('sets surface, text, field, border and muted text from data-passback-secondary', () => {
      const c = customColors('', '#1e293b');
      expect(c['--pb-color-surface']).toBe('#1e293b');
      expect(c['--pb-color-text']).toBe('#ffffff');
      expect(c['--pb-color-field']).toBe('color-mix(in srgb, #1e293b 90%, #ffffff)');
      expect(c['--pb-color-border']).toBe('color-mix(in srgb, #1e293b 80%, #ffffff)');
      expect(c['--pb-color-text-muted']).toBe('color-mix(in srgb, #ffffff 62%, #1e293b)');
      const style = hostWith(null, '#1e293b').style;
      expect(style.getPropertyValue('--pb-color-surface')).toBe('#1e293b');
    });

    it('takes main and on-main from the secondary colour when no main is set', () => {
      const c = customColors('', '#1e293b');
      expect(c['--pb-color-main']).toBe('#ffffff');
      expect(c['--pb-color-on-main']).toBe('#1e293b');
      expect(customColors('#2563eb', '#1e293b')['--pb-color-main']).toBe('#2563eb');
    });

    it('ignores a colour setting that is not #rrggbb', () => {
      for (const bad of ['#fff', 'red', 'rgb(0, 0, 0)', '#12345g', '']) {
        expect(customColors(bad, '')).toEqual({});
        const c = customColors(bad, '#1e293b');
        expect(c['--pb-color-surface']).toBe('#1e293b');
        const d = customColors('#2563eb', bad);
        expect(d['--pb-color-main']).toBe('#2563eb');
        expect(d['--pb-color-surface']).toBeUndefined();
      }
    });

    it('sets no inline colour when neither setting is given', () => {
      expect(hostWith(null, null).getAttribute('style') ?? '').toBe('');
      expect(customColors('', '')).toEqual({});
    });

    it('matches the scheme to the secondary colour', () => {
      expect(hostWith(null, '#1e293b', 'light').getAttribute('data-pb-scheme')).toBe('dark');
      expect(hostWith(null, '#f4f4f5', 'dark').getAttribute('data-pb-scheme')).toBe('light');
    });
  });
});
