// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Overlay, SubmitDetail } from './overlay';
import { createOverlay } from './overlay';
import { REST_MS, rest } from './rest';
import { sendAll } from './send-all';
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

function setup(addons: unknown[] = [sendAll]) {
  scope.__passback = { fx: { addons } };
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const onSubmit = vi.fn<(detail: SubmitDetail) => void>();
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit,
    drawing: { toggle: vi.fn(), cancel: vi.fn() },
  });
  overlays.push(overlay);
  return { host, root, overlay, onSubmit };
}
type R = ReturnType<typeof setup>;

function compose(root: ShadowRoot, text: string): void {
  const target = document.body.appendChild(document.createElement('div'));
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
  );
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
}

function keepAll(r: R, ...texts: string[]): void {
  r.overlay.arm();
  for (const text of texts) {
    compose(r.root, text);
    r.root.querySelector<HTMLElement>('[data-role="add-more"]')!.click();
  }
}

const sendAllButton = (r: R) =>
  r.root.querySelector<HTMLElement>(`.${TRAY_CLASS.tray} .${CLASS.send}`)!;
const comments = (r: R) => r.onSubmit.mock.calls.map(([detail]) => detail.comment);
const listed = (r: R) => r.root.querySelectorAll('.pb-list li').length;
const panel = (r: R) => r.host.getAttribute('data-pb-panel');
const flush = () => Promise.resolve();
const ack = async (r: R, id: string) => {
  r.overlay.acked(id, false, undefined, { relay: true });
  await flush();
};

describe('send all', () => {
  it('Send all sends each kept comment once, in order, and empties the list', async () => {
    const r = setup();
    keepAll(r, 'one', 'two', 'three');
    expect(listed(r)).toBe(3);
    sendAllButton(r).click();
    expect(comments(r)).toEqual(['one']);
    await ack(r, 'm1');
    expect(comments(r)).toEqual(['one', 'two']);
    expect(listed(r)).toBe(2);
    await ack(r, 'm2');
    await ack(r, 'm3');
    expect(comments(r)).toEqual(['one', 'two', 'three']);
    expect(listed(r)).toBe(0);
    expect(r.overlay.phase()).toBe('idle');
    expect(r.root.querySelectorAll(`.${CLASS.dot}`)).toHaveLength(3);
  });

  it('a bubble Send all sends the kept comments and the open one in order', async () => {
    const r = setup();
    keepAll(r, 'one');
    compose(r.root, 'two');
    const primary = r.root.querySelector<HTMLElement>(`.${CLASS.bubble} [data-role="send"]`)!;
    expect(primary.textContent).toBe('Send all');
    primary.click();
    expect(comments(r)).toEqual(['one']);
    await ack(r, 'm1');
    expect(comments(r)).toEqual(['one', 'two']);
    await ack(r, 'm2');
    expect(listed(r)).toBe(0);
  });

  it('Send all stops at a failed comment and continues after its retry is acknowledged', async () => {
    const r = setup();
    keepAll(r, 'one', 'two');
    sendAllButton(r).click();
    r.overlay.failed('boom');
    await flush();
    expect(comments(r)).toEqual(['one']);
    expect(listed(r)).toBe(2);
    r.root.querySelector<HTMLElement>(`.${CLASS.bubble} .${CLASS.send}`)!.click();
    expect(comments(r)).toEqual(['one', 'one']);
    await ack(r, 'm1');
    expect(comments(r)).toEqual(['one', 'one', 'two']);
    await ack(r, 'm2');
    expect(listed(r)).toBe(0);
  });

  it('Send all is ignored while composing or sending', async () => {
    const r = setup();
    keepAll(r, 'one');
    compose(r.root, 'draft');
    sendAllButton(r)?.click();
    r.host.dispatchEvent(new Event('passback:send-all'));
    expect(r.onSubmit).not.toHaveBeenCalled();
    expect(r.overlay.phase()).toBe('composing');
    const s = setup();
    keepAll(s, 'one', 'two');
    s.host.dispatchEvent(new Event('passback:send-all'));
    s.host.dispatchEvent(new Event('passback:send-all'));
    await flush();
    expect(comments(s)).toEqual(['one']);
  });

  it('Send all stops when the panel is closed during the drain and keeps the rest', async () => {
    const r = setup();
    keepAll(r, 'one', 'two');
    sendAllButton(r).click();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    expect(panel(r)).toBe('closed');
    await ack(r, 'm1');
    expect(comments(r)).toEqual(['one']);
    r.root.querySelector<HTMLElement>(`.${CLASS.launcher}`)!.click();
    expect(panel(r)).toBe('open');
    expect(listed(r)).toBe(1);
    expect(comments(r)).toEqual(['one']);
  });

  it('Send all keeps the widget open between comments and lets it rest after the last one', async () => {
    const r = setup([rest, sendAll]);
    keepAll(r, 'one', 'two');
    sendAllButton(r).click();
    vi.advanceTimersByTime(REST_MS * 2);
    expect(panel(r)).toBe('open');
    await ack(r, 'm1');
    vi.advanceTimersByTime(REST_MS * 2);
    expect(panel(r)).toBe('open');
    r.overlay.failed('boom');
    vi.advanceTimersByTime(REST_MS * 2);
    expect(panel(r)).toBe('open');
    r.root.querySelector<HTMLElement>(`.${CLASS.bubble} .${CLASS.send}`)!.click();
    await ack(r, 'm2');
    vi.advanceTimersByTime(REST_MS - 1);
    expect(panel(r)).toBe('open');
    vi.advanceTimersByTime(1);
    expect(panel(r)).toBe('rest');
  });
});
