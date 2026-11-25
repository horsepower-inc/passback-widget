// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';
import { palette } from './palette';

const scope = globalThis as { __passback?: unknown };
let overlays: Overlay[] = [];

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  delete scope.__passback;
  document.body.innerHTML = '';
});

function styles(): string {
  scope.__passback = { fx: { addons: [palette] } };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  overlays.push(
    createOverlay({
      doc: document,
      root,
      host,
      selectorOf: (el) => el.tagName.toLowerCase(),
      onSubmit: vi.fn(),
      drawing: { toggle: vi.fn(), cancel: vi.fn() },
    }),
  );
  return root.querySelector('style[data-pb-palette-styles]')?.textContent ?? '';
}

function rule(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

const TOOL = '.pb-palette :is(button[data-tool], button[data-act]) {';

describe('palette close motion', () => {
  it('R2b the closed tool rule has no transition delay so Point leaves with the others', () => {
    const css = styles();
    expect(rule(css, TOOL)).toContain(
      'transition: opacity var(--pb-motion-duration) var(--pb-motion-ease), transform var(--pb-motion-duration) var(--pb-motion-ease), visibility 0s linear var(--pb-motion-duration)',
    );
    expect(rule(css, TOOL)).not.toContain('calc(');
    expect(css).not.toContain('(6 - var(--pb-i, 0))');
  });

  it('R2b the closed state does not use the spring curve so nothing bounces on the way into the ball', () => {
    const css = styles();
    expect(rule(css, TOOL)).not.toContain('cubic-bezier');
    const open = rule(css, '.pb-palette[data-open] :is(');
    expect(open).toContain('transition-timing-function');
    expect(open).toContain('cubic-bezier');
  });

  it('R2b hides the bar as soon as the tools have left', () => {
    const bar = rule(styles(), '.pb-palette:not([data-open])');
    expect(bar).toContain('visibility 0s linear var(--pb-motion-duration)');
    expect(bar).not.toContain('* 35ms');
  });

  it('R2b Point and the last tool share one close timing', () => {
    expect(rule(styles(), TOOL)).not.toContain('--pb-i');
  });
});
