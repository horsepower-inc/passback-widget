// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createDot, type DotState } from './dot-view';
import { moveStamp, showStamp, stampRules } from './stamp';
import { styleSheet } from './styles';
import { TOKENS } from './tokens';

function shadow(): ShadowRoot {
  return document.createElement('div').attachShadow({ mode: 'open' });
}

function fold(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function stampRule(): string {
  const match = /\.pb-stamp \{[^}]*\}/.exec(stampRules());
  return match ? match[0] : '';
}

describe('stamp', () => {
  it('writes Fixed and a check mark and hides the stamp from screen readers', () => {
    const root = shadow();
    const stamp = showStamp(root, { x: 0, y: 0 });
    expect(stamp.textContent).toBe('Fixed ✓');
    expect(stamp.getAttribute('aria-hidden')).toBe('true');
    expect(stamp.className).toBe('pb-stamp');
    expect(stamp.parentNode).toBe(root);
  });

  it('puts the stamp 22px right of and 14px above the pin', () => {
    const stamp = showStamp(shadow(), { x: 100, y: 50 });
    expect(stamp.style.left).toBe('122px');
    expect(stamp.style.top).toBe('36px');
    moveStamp(stamp, { x: 10, y: 20 });
    expect(stamp.style.left).toBe('32px');
    expect(stamp.style.top).toBe('6px');
  });

  it('removes the stamp when its animation ends', () => {
    const root = shadow();
    const stamp = showStamp(root, { x: 0, y: 0 });
    stamp.dispatchEvent(new Event('animationend'));
    expect(root.contains(stamp)).toBe(false);
  });

  it('styles the stamp as bold italic capitals over a shadow in the fixed colour', () => {
    const rule = stampRule();
    expect(rule).toContain('font: italic 900 20px/1 system-ui, sans-serif');
    expect(rule).toContain('text-transform: uppercase');
    expect(rule).toContain('color: var(--pb-color-surface)');
    expect(rule).toContain('text-shadow: 2px 2px 0 var(--pb-color-ok)');
    expect(rule).toContain('pointer-events: none');
    expect(rule).toContain('white-space: nowrap');
  });

  it('pops the stamp tilted 8 degrees and fades it out within the stamp time', () => {
    const rule = stampRule();
    expect(rule).toContain(
      'animation: pb-stamp var(--pb-motion-stamp) var(--pb-motion-ease) forwards',
    );
    expect(rule).toContain('transform-origin: 0 100%');
    const frames = /@keyframes pb-stamp \{([\s\S]*?)\n\}/.exec(stampRules())?.[1] ?? '';
    const steps = [...frames.matchAll(/(\d+)% \{([^}]*)\}/g)];
    expect(steps.map((s) => s[1])).toEqual(['0', '12', '80', '100']);
    for (const step of steps) expect(step[2]).toContain('rotate(-8deg)');
    expect(steps[0]?.[2]).toContain('scale(1.7)');
    expect(steps[0]?.[2]).toContain('opacity: 0');
    expect(steps[3]?.[2]).toContain('opacity: 0');
    expect(TOKENS['--pb-motion-stamp']).toBe('1.8s');
  });

  it('does not show the stamp under reduced motion', () => {
    expect(fold(stampRules())).toContain(
      '@media (prefers-reduced-motion: reduce) { .pb-stamp { display: none; } }',
    );
  });

  it('is part of the widget stylesheet', () => {
    expect(styleSheet()).toContain(stampRules());
  });
});

describe('stamp on the pin', () => {
  function stamps(root: ShadowRoot): Element[] {
    return [...root.querySelectorAll('.pb-stamp')];
  }

  it('pops one stamp beside the pin when the pin turns fixed', () => {
    const root = shadow();
    const dot = createDot(root, { x: 100, y: 50 });
    dot.setState('running');
    dot.setState('done');
    const found = stamps(root);
    expect(found).toHaveLength(1);
    const stamp = found[0] as HTMLElement;
    expect(stamp.style.left).toBe('122px');
    expect(stamp.style.top).toBe('36px');
    expect(dot.element.getAttribute('data-state')).toBe('done');
    expect(dot.element.textContent).toBe('1');
  });

  it('pops no second stamp when fixed arrives again', () => {
    const root = shadow();
    const dot = createDot(root, { x: 100, y: 50 });
    dot.setState('done');
    const first = stamps(root)[0];
    dot.setState('done');
    expect(stamps(root)).toHaveLength(1);
    expect(stamps(root)[0]).toBe(first);
  });

  it('shows no stamp for a pin in any other state', () => {
    const others: DotState[] = ['pinned', 'sending', 'queued', 'running', 'failed', 'orphaned'];
    for (const state of others) {
      const root = shadow();
      const dot = createDot(root, { x: 1, y: 2 });
      dot.setState(state);
      expect(stamps(root)).toHaveLength(0);
    }
  });

  it('takes the stamp away when the pin leaves the fixed state', () => {
    const root = shadow();
    const dot = createDot(root, { x: 100, y: 50 });
    dot.setState('done');
    dot.setState('running');
    expect(stamps(root)).toHaveLength(0);
    dot.setState('done');
    expect(stamps(root)).toHaveLength(1);
  });

  it('takes the stamp away when the pin is removed', () => {
    const root = shadow();
    const dot = createDot(root, { x: 100, y: 50 });
    dot.setState('done');
    dot.remove();
    expect(stamps(root)).toHaveLength(0);
    expect(root.querySelector('.pb-dot')).toBeNull();
  });

  it('moves a showing stamp with its pin', () => {
    const root = shadow();
    const dot = createDot(root, { x: 100, y: 50 });
    dot.setState('done');
    dot.moveTo({ x: 10, y: 20 });
    const stamp = stamps(root)[0] as HTMLElement;
    expect(stamp.style.left).toBe('32px');
    expect(stamp.style.top).toBe('6px');
  });

  it('leaves the number on the pin once the stamp has gone', () => {
    const root = shadow();
    const dot = createDot(root, { x: 100, y: 50 });
    dot.setState('done');
    (stamps(root)[0] as Element).dispatchEvent(new Event('animationend'));
    expect(stamps(root)).toHaveLength(0);
    expect(dot.element.getAttribute('data-state')).toBe('done');
    expect(dot.element.textContent).toBe('1');
    expect(() => dot.moveTo({ x: 5, y: 5 })).not.toThrow();
    expect(() => dot.remove()).not.toThrow();
  });
});
