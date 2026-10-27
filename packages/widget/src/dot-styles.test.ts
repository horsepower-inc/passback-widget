import { describe, expect, it } from 'vitest';
import { dotRules } from './dot-styles';
import { CLASS, styleSheet } from './styles';

describe('dotRules', () => {
  it('names the pin dot with the same class as the stylesheet', () => {
    expect(dotRules()).toContain(`.${CLASS.dot} {`);
  });

  it('has a rule for the done, failed and orphaned states', () => {
    const css = dotRules();
    for (const state of ['done', 'failed', 'orphaned']) {
      expect(css).toContain(`.pb-dot[data-state="${state}"]`);
    }
  });

  it('colours the working states with the work token', () => {
    const css = dotRules().replace(/\s+/g, ' ');
    for (const state of ['sending', 'queued', 'running', 'sent']) {
      expect(css).toContain(`.pb-dot[data-state="${state}"]`);
    }
    expect(css).toContain('background: var(--pb-color-work); color: var(--pb-color-on-status);');
    expect(css).not.toContain('.pb-dot svg');
    let depth = 0;
    for (const ch of css) {
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
    expect(css).toMatch(
      /\} \.pb-dot\[data-state="sending"\], \.pb-dot\[data-state="queued"\], \.pb-dot\[data-state="running"\], \.pb-dot\[data-state="sent"\] \{ background: var\(--pb-color-work\);/,
    );
  });

  it('defines the spin and pulse keyframes', () => {
    const css = dotRules();
    expect(css).toContain('@keyframes pb-spin');
    expect(css).toContain('animation: pb-spin');
  });

  it('is part of the stylesheet text', () => {
    expect(styleSheet()).toContain(dotRules());
  });
});
