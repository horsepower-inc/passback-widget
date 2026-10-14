export type Rgba = readonly [number, number, number, number];

const COMMA_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/;
const SPACE_RE = /^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/;

export function parseColor(css: string): Rgba | undefined {
  const value = css.trim();
  if (value === 'transparent') return [0, 0, 0, 0];

  const match = COMMA_RE.exec(value) ?? SPACE_RE.exec(value);
  if (!match) return undefined;

  const [, r, g, b, a] = match;
  return [Number(r), Number(g), Number(b), a === undefined ? 1 : Number(a)];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: Rgba): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return round2((lighter + 0.05) / (darker + 0.05));
}

function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

const WHITE: Rgba = [255, 255, 255, 1];

function elementOpacity(el: Element): number {
  const value = Number.parseFloat(getComputedStyle(el).opacity);
  return Number.isNaN(value) ? 1 : value;
}

function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], alpha];
}

function ownBackgroundOver(el: Element, behind: Rgba): Rgba {
  const parsed = parseColor(getComputedStyle(el).backgroundColor);
  if (!parsed || parsed[3] === 0) return behind;
  if (parsed[3] === 1) return parsed;
  return compositeOver(parsed, behind);
}

// Every element with its own opacity starts a new isolated compositing group, so groups nest
// rather than flatten: an outer group's opacity must never be folded into an inner group's own
// multiplier. This finds the nearest ancestor-or-self that owns the group `el` renders inside —
// null when no ancestor in the chain has non-1 opacity.
function nearestOpacityBoundary(el: Element): Element | null {
  let current: Element | null = el;
  while (current) {
    if (elementOpacity(current) !== 1) return current;
    current = current.parentElement;
  }
  return null;
}

// Composites the own background of every element from `from` up to and including `boundary`,
// each at its own authored alpha only — group opacity is applied exactly once, later, at the
// boundary — over `behindGroup`, the fully resolved backdrop outside the whole group.
function groupLocalBackground(from: Element, boundary: Element, behindGroup: Rgba): Rgba {
  const behind =
    from === boundary
      ? behindGroup
      : groupLocalBackground(from.parentElement!, boundary, behindGroup);
  return ownBackgroundOver(from, behind);
}

// No opacity anywhere in the chain: plain background compositing up to the document base.
function chainBackgroundToRoot(el: Element | null): Rgba {
  if (!el) return WHITE;
  return ownBackgroundOver(el, chainBackgroundToRoot(el.parentElement));
}

interface Group {
  readonly boundary: Element | null;
  readonly behindGroup: Rgba;
  readonly localBg: Rgba;
}

// Resolves the isolated compositing group `el` belongs to: the backdrop outside that group, and
// el's own background composited within the group at its own alpha, before the group's opacity
// is applied.
function resolveGroup(el: Element): Group {
  const boundary = nearestOpacityBoundary(el);
  if (!boundary) return { boundary: null, behindGroup: WHITE, localBg: chainBackgroundToRoot(el) };

  const behindGroup = effectiveBackgroundOf(boundary.parentElement);
  const localBg = groupLocalBackground(el, boundary, behindGroup);
  return { boundary, behindGroup, localBg };
}

function effectiveBackgroundOf(el: Element | null): Rgba {
  if (!el) return WHITE;
  const { boundary, behindGroup, localBg } = resolveGroup(el);
  return boundary
    ? compositeOver(withAlpha(localBg, elementOpacity(boundary)), behindGroup)
    : localBg;
}

export function effectiveBackground(el: Element): Rgba {
  return effectiveBackgroundOf(el);
}

function hasOwnText(el: Element): boolean {
  return Array.from(el.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
  );
}

export function collectContrast(el: Element): number | undefined {
  if (!hasOwnText(el)) return undefined;

  const fgRaw = parseColor(getComputedStyle(el).color);
  if (!fgRaw) return undefined;

  const { boundary, behindGroup, localBg } = resolveGroup(el);
  const localFg = compositeOver(fgRaw, localBg);
  if (!boundary) return contrastRatio(localFg, localBg);

  const opacity = elementOpacity(boundary);
  const bg = compositeOver(withAlpha(localBg, opacity), behindGroup);
  const fg = compositeOver(withAlpha(localFg, opacity), behindGroup);

  return contrastRatio(fg, bg);
}
