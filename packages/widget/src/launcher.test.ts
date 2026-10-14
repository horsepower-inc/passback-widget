// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BALL_PATH, createLauncher, listenForHotkey } from './launcher';
import { CLASS, styleSheet } from './styles';

afterEach(() => {
  document.body.innerHTML = '';
});

function shadowRoot(): ShadowRoot {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host.attachShadow({ mode: 'open' });
}

describe('createLauncher', () => {
  it('appends one launcher button to the shadow root', () => {
    const root = shadowRoot();
    const launcher = createLauncher(root, () => {});
    const buttons = root.querySelectorAll(`button.${CLASS.launcher}`);
    expect(buttons.length).toBe(1);
    expect(buttons[0]).toBe(launcher.element);
    expect(launcher.element.getAttribute('aria-label')).toBe('Passback: pin a comment');
    expect(launcher.element.type).toBe('button');
  });

  it('calls onArm when the launcher is clicked', () => {
    const root = shadowRoot();
    const onArm = vi.fn();
    const launcher = createLauncher(root, onArm);
    launcher.element.click();
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it('hides the launcher while setVisible(false)', () => {
    const root = shadowRoot();
    const launcher = createLauncher(root, () => {});
    launcher.setVisible(false);
    expect(launcher.element.hasAttribute('hidden')).toBe(true);
    launcher.setVisible(true);
    expect(launcher.element.hasAttribute('hidden')).toBe(false);
  });

  it('removes the launcher on destroy', () => {
    const root = shadowRoot();
    const launcher = createLauncher(root, () => {});
    launcher.destroy();
    expect(root.contains(launcher.element)).toBe(false);
  });

  it('draws the football from the futbol-o path inside the button', () => {
    const launcher = createLauncher(shadowRoot(), () => {});
    const svgs = launcher.element.querySelectorAll('svg');
    expect(svgs.length).toBe(1);
    expect(svgs[0]?.getAttribute('viewBox')).toBe('0 0 28 28');
    expect(svgs[0]?.getAttribute('fill')).toBe('currentColor');
    const paths = launcher.element.querySelectorAll('path');
    expect(paths.length).toBe(1);
    expect(paths[0]?.getAttribute('d')).toBe(BALL_PATH);
    expect(BALL_PATH.startsWith('M9.516 12.75l4.484-3.25')).toBe(true);
    expect(BALL_PATH.endsWith('5.094-0.625z')).toBe(true);
  });

  it('keeps the badge hidden with no text until a count of one or more is set', () => {
    const launcher = createLauncher(shadowRoot(), () => {});
    const badge = launcher.element.querySelector(`.${CLASS.count}`);
    expect(badge?.hasAttribute('hidden')).toBe(true);
    expect(badge?.textContent).toBe('');
  });

  it('shows the count as a whole number and hides the badge again at zero', () => {
    const launcher = createLauncher(shadowRoot(), () => {});
    const badge = launcher.element.querySelector(`.${CLASS.count}`);
    launcher.setCount(3);
    expect(badge?.textContent).toBe('3');
    expect(badge?.hasAttribute('hidden')).toBe(false);
    launcher.setCount(2.9);
    expect(badge?.textContent).toBe('2');
    for (const value of [0, -1, Number.NaN]) {
      launcher.setCount(3);
      launcher.setCount(value);
      expect(badge?.textContent).toBe('');
      expect(badge?.hasAttribute('hidden')).toBe(true);
    }
  });

  it('hides the launcher and the badge by a stylesheet rule when hidden is set', () => {
    const css = styleSheet();
    expect(css).toMatch(
      /\.pb-launcher\[hidden\],\s*\.pb-count\[hidden\]\s*\{\s*display: none;/,
    );
  });

  it('places the launcher by data-corner in each of the four corners', () => {
    const css = styleSheet();
    for (const corner of ['bottom-left', 'top-right', 'top-left']) {
      expect(css).toContain(`.pb-launcher[data-corner='${corner}']`);
    }
    const base = /\.pb-launcher \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(base).toMatch(/\bright:/);
    expect(base).toMatch(/\bbottom:/);
  });

  it('uses only custom properties that the stylesheet declares', () => {
    const css = styleSheet();
    const used = new Set<string>();
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (rule[1] ?? '').trim();
      if (!selector.startsWith('.pb-launcher') && !selector.startsWith('.pb-count')) continue;
      for (const m of (rule[2] ?? '').matchAll(/var\((--pb-[a-z-]+)/g)) used.add(m[1] ?? '');
    }
    expect(used.size).toBeGreaterThan(0);
    for (const name of used) expect(css).toContain(`${name}:`);
  });
});

describe('listenForHotkey', () => {
  it('arms on Alt+Shift+M', () => {
    const onArm = vi.fn();
    listenForHotkey(document, onArm);
    const event = new KeyboardEvent('keydown', {
      altKey: true,
      shiftKey: true,
      code: 'KeyM',
      cancelable: true,
    });
    document.dispatchEvent(event);
    expect(onArm).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores M without both modifiers', () => {
    const onArm = vi.fn();
    listenForHotkey(document, onArm);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: true, shiftKey: false, code: 'KeyM' }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: false, shiftKey: true, code: 'KeyM' }),
    );
    expect(onArm).not.toHaveBeenCalled();
  });

  it('ignores a repeated keydown', () => {
    const onArm = vi.fn();
    listenForHotkey(document, onArm);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyM', repeat: true }),
    );
    expect(onArm).not.toHaveBeenCalled();
  });

  it('stops listening after the returned function runs', () => {
    const onArm = vi.fn();
    const stop = listenForHotkey(document, onArm);
    stop();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyM' }),
    );
    expect(onArm).not.toHaveBeenCalled();
  });

  it('ignores a hotkey typed in the comment box', () => {
    const onArm = vi.fn();
    listenForHotkey(document, onArm);
    const area = shadowRoot().appendChild(document.createElement('textarea'));
    const event = new KeyboardEvent('keydown', {
      altKey: true,
      shiftKey: true,
      code: 'KeyM',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    area.dispatchEvent(event);
    expect(onArm).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    const page = document.body.appendChild(document.createElement('textarea'));
    page.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyM', bubbles: true }));
    expect(onArm).toHaveBeenCalledTimes(1);
  });

  it('installs nothing for a disabled hotkey', () => {
    const onArm = vi.fn();
    const add = vi.spyOn(document, 'addEventListener');
    const stop = listenForHotkey(document, onArm, null);
    expect(add).not.toHaveBeenCalled();
    add.mockRestore();
    document.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, shiftKey: true, code: 'KeyM' }));
    expect(onArm).not.toHaveBeenCalled();
    expect(stop()).toBeUndefined();
  });
});
