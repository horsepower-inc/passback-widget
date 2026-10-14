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

  it('defines the spin and pulse keyframes', () => {
    const css = dotRules();
    expect(css).toContain('@keyframes pb-spin');
    expect(css).toContain('animation: pb-spin');
  });

  it('is part of the stylesheet text', () => {
    expect(styleSheet()).toContain(dotRules());
  });
});
