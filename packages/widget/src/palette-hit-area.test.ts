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

function mount(): { root: ShadowRoot; host: HTMLElement } {
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
  return { root, host };
}

function css(root: ShadowRoot, marker: string): string {
  return root.querySelector(`style[${marker}]`)?.textContent ?? '';
}

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(sheet: string, selector: string): string {
  const start = sheet.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return sheet.slice(start, sheet.indexOf('}', start));
}

describe('palette hit area', () => {
  it('open palette owns its transparent rectangular hit area', () => {
    const { root } = mount();
    const sheet = css(root, 'data-pb-palette-styles');
    expect(rule(sheet, '.pb-palette[data-open]')).toContain('pointer-events: auto');
    expect(rule(sheet, '.pb-palette')).toContain('pointer-events: none');
    expect(rule(sheet, '.pb-palette[data-open]')).not.toMatch(/background|border|box-shadow/);
  });

  it('palette text and help use the widget font token', () => {
    const { root } = mount();
    const bar = root.querySelector('.pb-palette') as HTMLElement;
    const palSheet = css(root, 'data-pb-palette-styles');
    const helpSheet =
      css(root, 'data-pb-help-styles') ||
      bar.querySelector('style[data-pb-help-styles]')?.textContent ||
      '';
    const help = rule(helpSheet, ".pb-palette button[data-act='help']");
    expect(help).toContain('font: var(--pb-font-body)');
    expect(help).toContain('font-weight: 600');
    expect(help).toContain('line-height: 1');
    expect(rule(helpSheet, '.pb-help')).toContain('font: var(--pb-font-body)');
    expect(rule(palSheet, ".pb-palette button[data-act='clear-sent']")).toContain(
      'font: var(--pb-font-body)',
    );
  });

  it('closing and disposing release the palette hit area', () => {
    const { root, host } = mount();
    const bar = root.querySelector('.pb-palette') as HTMLElement;
    // Interception is keyed on [data-open], which closing removes at once.
    expect(bar.hasAttribute('data-open')).toBe(false);
    bar.setAttribute('data-open', '');
    bar.removeAttribute('data-open');
    expect(bar.hasAttribute('data-open')).toBe(false);
    const sheet = css(root, 'data-pb-palette-styles');
    expect(rule(sheet, '.pb-palette:not([data-open])')).not.toContain('pointer-events: auto');
    host.dispatchEvent(new Event('passback:dispose'));
    expect(root.querySelector('.pb-palette')).toBeNull();
    expect(root.querySelector('style[data-pb-palette-styles]')).toBeNull();
  });
});
