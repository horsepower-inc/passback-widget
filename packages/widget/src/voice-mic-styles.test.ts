import { describe, expect, it } from 'vitest';
import { voiceMicStyles } from './voice-mic-styles';

describe('voice mic styles', () => {
  it('uses only tokens and no colour literal', () => {
    const css = voiceMicStyles();
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/i);
    expect(css).toContain('var(--pb-color-bad)');
    const colours = css.match(/(?:color|background|border(?!-radius))[a-z-]*:[^;]+;/g) ?? [];
    for (const line of colours) expect(line).toMatch(/var\(--pb-|transparent|thin|none/);
  });

  it('stills the dot under reduced motion', () => {
    const css = voiceMicStyles();
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(css).toContain('animation: pb-voice-pulse');
    expect(reduced).toContain('[data-role="voice-dot"] { animation: none; }');
  });
});
