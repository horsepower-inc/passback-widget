// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXED_CLEAR_MS, dismissMarks } from './dismiss-marks';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';
import { palette } from './palette';
import { CLASS } from './styles';

const scope = globalThis as { __passback?: unknown };
let overlays: Overlay[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  delete scope.__passback;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function setup(withPort: boolean, applied = true) {
  scope.__passback = { fx: { addons: [palette, dismissMarks] } };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn(),
    reopen: withPort ? { send: vi.fn(async () => applied) } : undefined,
  });
  overlays.push(overlay);
  return { host, root, overlay };
}

function fix(r: ReturnType<typeof setup>, id: string): void {
  r.overlay.arm();
  const target = document.body.appendChild(document.createElement('div'));
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
  );
  const input = r.root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = id;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  r.overlay.acked(id, false, undefined, { relay: false });
  r.overlay.status({ markId: id, state: 'done' });
  r.host.dispatchEvent(new Event('passback:sync'));
}

const dismiss = (root: ShadowRoot) =>
  root.querySelector<HTMLButtonElement>("button[part='dismiss']");

function reopenWith(root: ShadowRoot, text: string, key: string): void {
  root.querySelector<HTMLButtonElement>('button[data-role="reopen"]')!.click();
  const area = root.querySelector<HTMLTextAreaElement>(`.${CLASS.bubble} textarea`)!;
  area.value = text;
  area.dispatchEvent(new Event('input'));
  area.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true }),
  );
}

const dots = (root: ShadowRoot) => root.querySelectorAll(`.${CLASS.dot}`).length;
const clearButton = (root: ShadowRoot) =>
  root.querySelector<HTMLButtonElement>("button[data-act='clear-sent']")!;

describe('dismissMarks with a reopen port', () => {
  it('keeps a fixed mark after the stamp when a reopen port exists', () => {
    const r = setup(true);
    fix(r, 'm1');
    vi.advanceTimersByTime(FIXED_CLEAR_MS + 100);
    expect(dots(r.root)).toBe(1);
  });

  it('gives a kept fixed mark a Dismiss control that removes it', () => {
    const r = setup(true);
    fix(r, 'm1');
    r.root.querySelector<HTMLButtonElement>("button[part='dismiss']")!.click();
    expect(dots(r.root)).toBe(0);
  });

  it('keeps the Dismiss control after the reopen box is cancelled', () => {
    const r = setup(true);
    fix(r, 'm1');
    reopenWith(r.root, '', 'Escape');
    expect(dismiss(r.root)).not.toBeNull();
  });

  it('keeps the Dismiss control after a reopen the port reports as not applied', async () => {
    const r = setup(true, false);
    fix(r, 'm1');
    reopenWith(r.root, 'still off', 'Enter');
    await vi.runAllTimersAsync();
    expect(r.root.querySelector(`.${CLASS.bubble}`)!.textContent).toContain('Not sent');
    expect(dismiss(r.root)).not.toBeNull();
  });

  it('Clear sent removes the fixed marks kept for reopening', () => {
    const r = setup(true);
    fix(r, 'm1');
    expect(clearButton(r.root).hidden).toBe(false);
    clearButton(r.root).click();
    expect(dots(r.root)).toBe(0);
  });

  it('still clears a fixed mark after the stamp when there is no reopen port', () => {
    const r = setup(false);
    fix(r, 'm1');
    vi.advanceTimersByTime(FIXED_CLEAR_MS + 100);
    expect(dots(r.root)).toBe(0);
  });
});
