// Accent is a border and focus-ring colour requiring 3:1 for a non-text component.
// Light #7c9dff on #ffffff measures 2.58:1: a design decision for the human,
// deliberately documented but not asserted here. Halo and ink carry no text.
import { describe, expect, it } from 'vitest';
import { SCHEMES } from './tokens';

function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Expected #rrggbb colour, got ${hex}`);
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function expectTextContrast(foreground: string, backgrounds: readonly string[]): void {
  for (const scheme of ['light', 'dark'] as const) {
    for (const background of backgrounds) {
      const ratio = contrast(SCHEMES[scheme][foreground]!, SCHEMES[scheme][background]!);
      expect(
        ratio,
        `${scheme}: ${foreground} on ${background} = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
}

describe('style kit text contrast', () => {
  it('keeps text at 4.5:1 or more on the surface and on the field in both schemes', () => {
    expectTextContrast('--pb-color-text', ['--pb-color-surface', '--pb-color-field']);
  });

  it('keeps muted text at 4.5:1 or more on the surface and on the field in both schemes', () => {
    expectTextContrast('--pb-color-text-muted', ['--pb-color-surface', '--pb-color-field']);
  });

  it('keeps text on the main, ok, bad and ask grounds at 4.5:1 or more in both schemes', () => {
    expectTextContrast('--pb-color-on-main', ['--pb-color-main']);
    expectTextContrast('--pb-color-on-status', [
      '--pb-color-ok',
      '--pb-color-bad',
      '--pb-color-ask',
    ]);
  });
});
