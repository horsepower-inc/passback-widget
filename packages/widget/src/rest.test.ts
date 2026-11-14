// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';
import { REST_MS, rest } from './rest';
import { CLASS } from './styles';
import { TRAY_CLASS } from './tray-view';

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

function setup() {
  scope.__passback = { fx: { addons: [rest] } };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn(),
  });
  overlays.push(overlay);
  const ball = () => root.querySelector<HTMLButtonElement>(`.${CLASS.launcher}`)!;
  const panel = () => host.getAttribute('data-pb-panel');
  return { host, root, overlay, ball, panel };
}

function compose(root: ShadowRoot, text: string): HTMLTextAreaElement {
  const target = document.body.appendChild(document.createElement('div'));
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  return input;
}

const enter = (input: HTMLTextAreaElement) =>
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
const escape = () =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));

function sendOne(r: ReturnType<typeof setup>, relay = true) {
  r.overlay.arm();
  enter(compose(r.root, 'hi'));
  r.overlay.acked('m1', false, undefined, { relay });
}

describe('rest', () => {
  it('R5 rests after the last acknowledged send and keeps the dot', () => {
    const r = setup();
    sendOne(r, false);
    expect(r.panel()).toBe('open');
    vi.advanceTimersByTime(REST_MS - 1);
    expect(r.panel()).toBe('open');
    vi.advanceTimersByTime(1);
    expect(r.panel()).toBe('rest');
    expect(r.root.querySelectorAll(`.${CLASS.dot}`)).toHaveLength(1);
    const css = r.root.querySelector('style[data-pb-rest-styles]')?.textContent ?? '';
    expect(css).toContain(`:host([data-pb-panel='rest']) .${CLASS.bubble}`);
    expect(css).toContain(`.${TRAY_CLASS.tray}`);
    expect(css).toContain('display: none !important');
    expect(r.ball().getAttribute('aria-label')).not.toBe('Passback: close');
    expect(r.ball().querySelector('path')?.getAttribute('d')).not.toContain('L14');
    expect(r.ball().querySelector(`.${CLASS.count}`)!.hasAttribute('hidden')).toBe(false);
  });

  it('R5 does not rest while a comment is kept, pinned or failed', () => {
    const r = setup();
    r.overlay.arm();
    enter(compose(r.root, 'one'));
    r.overlay.failed('boom');
    vi.advanceTimersByTime(REST_MS * 2);
    expect(r.panel()).toBe('open');
    r.root.querySelector<HTMLElement>(`.${CLASS.send}`)!.click();
    r.overlay.acked('m1', false, undefined, { relay: true });
    r.ball().click();
    compose(r.root, 'draft');
    vi.advanceTimersByTime(REST_MS * 2);
    expect(r.panel()).toBe('open');
    r.root.querySelector<HTMLElement>('[data-role="add-more"]')!.click();
    vi.advanceTimersByTime(REST_MS * 2);
    expect(r.panel()).toBe('open');
  });

  it('R5 cancels the timer when the ball is pressed or a new comment starts', () => {
    const r = setup();
    sendOne(r);
    vi.advanceTimersByTime(REST_MS - 1);
    r.ball().click();
    vi.advanceTimersByTime(REST_MS * 2);
    expect(r.panel()).toBe('open');
    compose(r.root, '');
    vi.advanceTimersByTime(REST_MS * 2);
    expect(r.panel()).toBe('open');
  });

  it('R5 rests in relay and local mode alike', () => {
    for (const relay of [true, false]) {
      const r = setup();
      sendOne(r, relay);
      vi.advanceTimersByTime(REST_MS);
      expect(r.panel()).toBe('rest');
    }
  });

  it('R5 reopens from rest with the ball and ignores Escape while resting', () => {
    const r = setup();
    sendOne(r);
    vi.advanceTimersByTime(REST_MS);
    escape();
    expect(r.panel()).toBe('rest');
    r.ball().click();
    expect(r.panel()).toBe('open');
    expect(r.overlay.phase()).toBe('armed');
    r.overlay.destroy();
    expect(r.root.querySelector('style[data-pb-rest-styles]')).toBeNull();
  });
});
