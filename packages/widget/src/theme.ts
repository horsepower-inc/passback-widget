import { scriptAttr } from './config';
import { SCHEME_ATTRIBUTE } from './styles';
import type { Scheme } from './tokens';

export type Rgb = { r: number; g: number; b: number; a: number };
export type Theme = 'auto' | Scheme;

const LIGHT_PAGE = 0.4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseAlpha(text: string): number {
  if (text.endsWith('%')) return clamp(Number(text.slice(0, -1)) / 100, 0, 1);
  return clamp(Number(text), 0, 1);
}

function parseFunctional(body: string): Rgb | undefined {
  const parts = body.split(/[\s,/]+/).filter((part) => part !== '');
  if (parts.length !== 3 && parts.length !== 4) return undefined;
  const [r, g, b] = parts.slice(0, 3).map((part) => clamp(Number(part), 0, 255));
  const a = parts.length === 4 ? parseAlpha(parts[3] ?? '') : 1;
  if (r === undefined || g === undefined || b === undefined) return undefined;
  if ([r, g, b, a].some((n) => Number.isNaN(n))) return undefined;
  return { r, g, b, a };
}

export function parseColor(text: string): Rgb | undefined {
  const value = text.trim().toLowerCase();
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (/^#[0-9a-f]{6}$/.test(value)) {
    const n = parseInt(value.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const match = /^rgba?\(([^()]*)\)$/.exec(value);
  return match ? parseFunctional(match[1] ?? '') : undefined;
}

function linear(channel: number): number {
  const x = channel / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

export function luminance(color: Pick<Rgb, 'r' | 'g' | 'b'>): number {
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

export function schemeFor(theme: Theme, backgrounds: readonly string[]): Scheme {
  if (theme !== 'auto') return theme;
  let page: Pick<Rgb, 'r' | 'g' | 'b'> = { r: 255, g: 255, b: 255 };
  for (const text of backgrounds) {
    const color = parseColor(text);
    if (color && color.a > 0) {
      page = color;
      break;
    }
  }
  return luminance(page) > LIGHT_PAGE ? 'dark' : 'light';
}

export function readTheme(doc: Document): Theme {
  const value = scriptAttr(doc, 'data-passback-theme');
  return value === 'light' || value === 'dark' ? value : 'auto';
}

export function contrast(a: Pick<Rgb, 'r' | 'g' | 'b'>, b: Pick<Rgb, 'r' | 'g' | 'b'>): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE = '#ffffff';
const INK = '#17181c';
const MIN_CONTRAST = 4.5;

function rgbOf(hex: string): Rgb {
  return parseColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
}

export function inkOn(hex: string): '#ffffff' | '#17181c' | '#000000' {
  const colour = rgbOf(hex);
  if (contrast(rgbOf(WHITE), colour) >= MIN_CONTRAST) return WHITE;
  return contrast(rgbOf(INK), colour) >= MIN_CONTRAST ? INK : '#000000';
}

function validHex(value: string): string {
  const text = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(text) ? text : '';
}

export function customColors(main: string, secondary: string): Record<string, string> {
  const m = validHex(main);
  const s = validHex(secondary);
  const out: Record<string, string> = {};
  if (m) {
    const on = inkOn(m);
    out['--pb-color-main'] = m;
    out['--pb-color-accent'] = m;
    out['--pb-color-on-main'] = on;
    out['--pb-color-halo'] = on === WHITE ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.7)';
  }
  if (s) {
    const t = inkOn(s);
    out['--pb-color-surface'] = s;
    out['--pb-color-text'] = t;
    out['--pb-color-field'] = `color-mix(in srgb, ${s} 90%, ${t})`;
    out['--pb-color-border'] = `color-mix(in srgb, ${s} 80%, ${t})`;
    out['--pb-color-text-muted'] = `color-mix(in srgb, ${t} 62%, ${s})`;
    if (!m) {
      out['--pb-color-main'] = t;
      out['--pb-color-on-main'] = s;
    }
  }
  return out;
}

function backgroundOf(el: Element, win: Pick<Window, 'getComputedStyle'>): string {
  try {
    return win.getComputedStyle(el).backgroundColor;
  } catch {
    return '';
  }
}

export function applyTheme(
  host: HTMLElement,
  doc: Document,
  win: Pick<Window, 'getComputedStyle'>,
): void {
  const elements = doc.body ? [doc.body, doc.documentElement] : [doc.documentElement];
  const backgrounds = elements.map((el) => backgroundOf(el, win));
  let scheme = schemeFor(readTheme(doc), backgrounds);
  const main = scriptAttr(doc, 'data-passback-main') ?? '';
  const secondary = scriptAttr(doc, 'data-passback-secondary') ?? '';
  const colors = customColors(main, secondary);
  for (const [name, value] of Object.entries(colors)) host.style.setProperty(name, value);
  const surface = validHex(secondary);
  if (surface) scheme = inkOn(surface) === WHITE ? 'dark' : 'light';
  host.setAttribute(SCHEME_ATTRIBUTE, scheme);
}
