// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLASS, styleSheet } from './styles';
import { armWidget as armViaLauncher } from './test-arm';
import type { Overlay, OverlayOptions, SubmitDetail } from './overlay';
import { createOverlay } from './overlay';

let overlays: Overlay[] = [];

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  document.body.innerHTML = '';
});

function setup(
  overrides: {
    onSubmit?(detail: SubmitDetail): void;
    selectorOf?(el: Element): string;
    guard?: OverlayOptions['guard'];
  } = {},
) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const onSubmit = overrides.onSubmit ?? vi.fn();
  const selectorOf = overrides.selectorOf ?? ((el: Element) => el.tagName.toLowerCase());
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf,
    onSubmit,
    guard: overrides.guard,
  });
  overlays.push(overlay);
  return { host, root, overlay, onSubmit, selectorOf };
}

function launcherEl(root: ShadowRoot): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(`.${CLASS.launcher}`)!;
}

describe('launcher spin', () => {
  it('arming sets data-open on the launcher and Escape removes it', () => {
    const { root } = setup();
    expect(launcherEl(root).hasAttribute('data-open')).toBe(false);
    armViaLauncher(root);
    expect(launcherEl(root).hasAttribute('data-open')).toBe(true);
    expect(launcherEl(root).querySelectorAll('svg').length).toBe(2);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(launcherEl(root).hasAttribute('data-open')).toBe(false);
  });

  it('the stylesheet spins the ball over 350 ms into the cross and stops the motion under reduced motion', () => {
    const css = styleSheet();
    expect(css).toContain(
      '.pb-launcher[data-open] .pb-ball { transform: rotate(720deg) scale(0.3)',
    );
    expect(css).toContain('.pb-launcher[data-open] .pb-cross { transform: none');
    expect(css).toMatch(
      /\[data-open\] \.pb-cross[^\n]*transform 350ms cubic-bezier\(0\.5, 0, 0\.3, 1\)/,
    );
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)[^]*\.pb-launcher svg[^]*transition: none/,
    );
  });
});
