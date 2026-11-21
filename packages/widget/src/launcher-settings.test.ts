// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLauncher, listenForHotkey, showLauncher } from './launcher';
import type { Launcher } from './launcher';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';
import { CLASS } from './styles';

let overlays: Overlay[] = [];

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function makeRoot(): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return { host, root: host.attachShadow({ mode: 'open' }) };
}

function hiddenLauncher(): Launcher {
  return createLauncher(makeRoot().root, vi.fn(), { corner: 'bottom-right', launcher: 'hidden' });
}

function mark(lastState: string): { lastState: string } {
  return { lastState };
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
}

function addScript(attrs: Record<string, string>): void {
  const script = document.createElement('script');
  Object.entries(attrs).forEach(([name, value]) => script.setAttribute(name, value));
  document.head.appendChild(script);
}

function startOverlay(): { root: ShadowRoot; overlay: Overlay; button: HTMLButtonElement } {
  const { host, root } = makeRoot();
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn(),
  });
  overlays.push(overlay);
  const button = root.querySelector<HTMLButtonElement>(`.${CLASS.launcher}`)!;
  return { root, overlay, button };
}

function pinAndType(root: ShadowRoot, text: string): HTMLTextAreaElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  target.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: 5,
      clientY: 6,
    }),
  );
  const textarea = root.querySelector<HTMLTextAreaElement>('textarea')!;
  textarea.value = text;
  textarea.dispatchEvent(new Event('input'));
  return textarea;
}

function pinAndComment(root: ShadowRoot, text: string): void {
  pinAndType(root, text).dispatchEvent(key({ key: 'Enter' }));
}

describe('launcher settings', () => {
  it('puts the corner setting on the launcher as data-corner', () => {
    const top = createLauncher(makeRoot().root, vi.fn(), {
      corner: 'top-left',
      launcher: 'visible',
    });
    expect(top.element.getAttribute('data-corner')).toBe('top-left');
    const dflt = createLauncher(makeRoot().root, vi.fn());
    expect(dflt.element.getAttribute('data-corner')).toBe('bottom-right');
    expect(dflt.element.hasAttribute('hidden')).toBe(false);
  });

  it('keeps a hidden launcher hidden until the page has a pin', () => {
    const launcher = hiddenLauncher();
    expect(launcher.element.hasAttribute('hidden')).toBe(true);
    launcher.setVisible(true);
    expect(launcher.element.hasAttribute('hidden')).toBe(true);
    showLauncher(launcher, [mark('queued')]);
    expect(launcher.element.hasAttribute('hidden')).toBe(false);
  });

  it('hides a hidden launcher again when no pin is left', () => {
    const launcher = hiddenLauncher();
    showLauncher(launcher, [mark('queued')]);
    showLauncher(launcher, []);
    expect(launcher.element.hasAttribute('hidden')).toBe(true);
  });

  it('counts the pins that are not fixed on the badge', () => {
    const launcher = createLauncher(makeRoot().root, vi.fn());
    const badge = launcher.element.querySelector(`.${CLASS.count}`)!;
    launcher.update([mark('queued'), mark('running'), mark('done')]);
    expect(badge.textContent).toBe('2');
    expect(badge.hasAttribute('hidden')).toBe(false);
    launcher.update([mark('done'), mark('done')]);
    expect(badge.hasAttribute('hidden')).toBe(true);
  });

  it('arms on the configured hotkey and not on alt+shift+r', () => {
    const onArm = vi.fn();
    const stop = listenForHotkey(document, onArm, {
      alt: false,
      shift: true,
      ctrl: true,
      meta: false,
      code: 'KeyK',
    });
    document.dispatchEvent(key({ altKey: true, shiftKey: true, code: 'KeyR' }));
    expect(onArm).not.toHaveBeenCalled();
    const event = key({ ctrlKey: true, shiftKey: true, code: 'KeyK' });
    document.dispatchEvent(event);
    expect(onArm).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    stop();
  });

  it('requires exactly the modifiers of the hotkey', () => {
    const onArm = vi.fn();
    const stop = listenForHotkey(document, onArm);
    document.dispatchEvent(key({ altKey: true, shiftKey: true, ctrlKey: true, code: 'KeyR' }));
    expect(onArm).not.toHaveBeenCalled();
    stop();
  });

  it('reads corner, launcher and hotkey from the script tag when the overlay is created', () => {
    addScript({
      'data-passback-corner': 'top-left',
      'data-passback-launcher': 'hidden',
      'data-passback-hotkey': 'ctrl+shift+k',
    });
    const { overlay, button } = startOverlay();
    expect(button.hasAttribute('hidden')).toBe(true);
    expect(button.getAttribute('data-corner')).toBe('top-left');
    document.dispatchEvent(key({ ctrlKey: true, shiftKey: true, code: 'KeyK' }));
    expect(overlay.phase()).toBe('armed');
  });

  it('shows a hidden launcher with a badge of one after the comment is acknowledged and drops the badge when it is fixed', () => {
    addScript({ 'data-passback-launcher': 'hidden' });
    const { root, overlay, button } = startOverlay();
    overlay.arm();
    pinAndComment(root, 'hello');
    overlay.acked('m1', false);
    const badge = root.querySelector(`.${CLASS.count}`)!;
    expect(button.hasAttribute('hidden')).toBe(false);
    expect(badge.textContent).toBe('1');
    overlay.status({ markId: 'm1', state: 'done' });
    expect(badge.hasAttribute('hidden')).toBe(true);
    expect(button.hasAttribute('hidden')).toBe(false);
  });

  it('R1 shows the close control while open and retained count after Escape', () => {
    addScript({ 'data-passback-launcher': 'hidden' });
    const { root, overlay, button } = startOverlay();
    const badge = root.querySelector(`.${CLASS.count}`)!;
    // phase|launcher hidden|launcher name|badge
    const view = () =>
      [overlay.phase(), button.hasAttribute('hidden'), button.getAttribute('aria-label')]
        .concat(badge.textContent ?? '')
        .join('|');
    expect(view()).toBe('idle|true|Passback: pin a comment|');
    document.dispatchEvent(key({ altKey: true, shiftKey: true, code: 'KeyR' }));
    expect(view()).toBe('armed|false|Passback: close|');

    pinAndType(root, 'draft').dispatchEvent(key({ key: 'Escape' }));
    expect(view()).toBe('idle|false|Passback: pin a comment|1');

    button.click();
    expect(view()).toBe('armed|false|Passback: close|1');
    pinAndType(root, '  ').dispatchEvent(key({ key: 'Escape' }));
    expect(view()).toBe('idle|false|Passback: pin a comment|1');
    expect(root.querySelectorAll(`.${CLASS.dot}`)).toHaveLength(1);
  });
});
