// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Overlay, SubmitDetail } from './overlay';
import type { BatchOutcome, SubmitAllDetail } from './send-batch';
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
  const batches: SubmitAllDetail[] = [];
  host.addEventListener('passback:submit-all', (event) =>
    batches.push((event as CustomEvent<SubmitAllDetail>).detail),
  );
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit,
    drawing: { toggle: vi.fn(), cancel: vi.fn() },
  });
  overlays.push(overlay);
  return { host, root, overlay, onSubmit, batches };
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
const listed = (r: R) => r.root.querySelectorAll('.pb-list li').length;
const panel = (r: R) => r.host.getAttribute('data-pb-panel');
const states = (r: R) =>
  [...r.root.querySelectorAll(`.${CLASS.dot}`)].map((dot) => dot.getAttribute('data-state'));
const okAll = (n: number, relay = true): BatchOutcome => ({
  ok: true,
  ids: Array<string>(n).fill('t1'),
  trimmed: Array<boolean>(n).fill(false),
  notes: Array<string | undefined>(n).fill(undefined),
  relay,
});
const retry = (r: R) =>
  [...r.root.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Retry')!;

describe('send all', () => {
  it('Send all dispatches one submit-all with a detail per kept comment and the numbers of every kept mark', () => {
    const r = setup();
    keepAll(r, 'one', 'two', 'three');
    expect(listed(r)).toBe(3);
    sendAllButton(r).click();
    expect(r.batches).toHaveLength(1);
    const { details } = r.batches[0]!;
    expect(details.map((d) => d.comment)).toEqual(['one', 'two', 'three']);
    expect(r.onSubmit).not.toHaveBeenCalled();
    details.forEach((detail, i) => {
      expect(detail.marks!.map(({ n, current }) => [n, current])).toEqual(
        [1, 2, 3].map((n) => [n, n === i + 1]),
      );
      expect(detail.marks!.map((m) => m.element)).toEqual(details.map((d) => d.element));
    });
    expect(states(r)).toEqual(['sending', 'sending', 'sending']);
    expect(r.overlay.phase()).toBe('sending');
  });

  it('one acknowledgement pops every check dot and empties the list', () => {
    const r = setup();
    keepAll(r, 'one', 'two', 'three');
    sendAllButton(r).click();
    r.batches[0]!.settle(okAll(3));
    expect(states(r)).toEqual(['sent', 'sent', 'sent']);
    expect(listed(r)).toBe(0);
    expect(r.overlay.phase()).toBe('idle');
    r.batches[0]!.settle(okAll(3));
    expect(r.batches).toHaveLength(1);
  });

  it('a failed batch keeps every comment, shows the error once and sends the whole batch again on retry', () => {
    const r = setup();
    keepAll(r, 'one', 'two');
    sendAllButton(r).click();
    r.batches[0]!.settle({ ok: false, message: 'boom' });
    expect(listed(r)).toBe(2);
    expect(states(r)).toEqual(['failed', 'failed']);
    expect(r.root.textContent!.match(/boom/g)).toHaveLength(1);
    retry(r).click();
    expect(r.batches).toHaveLength(2);
    expect(r.batches[1]!.details.map((d) => d.comment)).toEqual(['one', 'two']);
    expect(states(r)).toEqual(['sending', 'sending']);
    r.batches[1]!.settle(okAll(2, false));
    expect(states(r)).toEqual(['queued', 'queued']);
    expect(listed(r)).toBe(0);
    expect(r.batches).toHaveLength(2);
  });

  it('a Send all with a second Send all after a failure is accepted from the panel', () => {
    const r = setup();
    keepAll(r, 'one');
    sendAllButton(r).click();
    r.batches[0]!.settle({ ok: false, message: 'boom' });
    r.host.dispatchEvent(new Event('passback:send-all'));
    expect(r.batches).toHaveLength(2);
  });

  it('deleting every comment of a failed batch returns the widget to idle', () => {
    const r = setup();
    keepAll(r, 'one', 'two');
    sendAllButton(r).click();
    r.batches[0]!.settle({ ok: false, message: 'boom' });
    for (const n of [2, 1])
      r.root.querySelector<HTMLElement>(`[aria-label="Delete comment ${n}"]`)!.click();
    expect(listed(r)).toBe(0);
    expect(r.overlay.phase()).toBe('idle');
    r.overlay.arm();
    expect(r.overlay.phase()).toBe('armed');
    keepAll(r, 'three');
    sendAllButton(r).click();
    expect(r.batches.map((b) => b.details.map((d) => d.comment))).toEqual([
      ['one', 'two'],
      ['three'],
    ]);
  });

  it('Send all is ignored while composing or while a batch is pending', () => {
    const r = setup();
    keepAll(r, 'one');
    compose(r.root, 'draft');
    sendAllButton(r)?.click();
    r.host.dispatchEvent(new Event('passback:send-all'));
    expect(r.batches).toHaveLength(0);
    expect(r.overlay.phase()).toBe('composing');
    const s = setup();
    keepAll(s, 'one', 'two');
    s.host.dispatchEvent(new Event('passback:send-all'));
    s.host.dispatchEvent(new Event('passback:send-all'));
    expect(s.batches).toHaveLength(1);
  });

  it('a late settle after dispose does nothing', () => {
    const r = setup();
    keepAll(r, 'one');
    sendAllButton(r).click();
    r.host.dispatchEvent(new Event('passback:dispose'));
    r.batches[0]!.settle(okAll(1));
    expect(states(r)).toEqual(['sending']);
    expect(listed(r)).toBe(1);
  });

  it('Send all keeps the widget open until the batch settles and lets it rest after', () => {
    const r = setup([rest, sendAll]);
    keepAll(r, 'one', 'two');
    sendAllButton(r).click();
    vi.advanceTimersByTime(REST_MS * 2);
    expect(panel(r)).toBe('open');
    r.batches[0]!.settle({ ok: false, message: 'boom' });
    vi.advanceTimersByTime(REST_MS * 2);
    expect(panel(r)).toBe('open');
    retry(r).click();
    r.batches[1]!.settle(okAll(2));
    vi.advanceTimersByTime(REST_MS - 1);
    expect(panel(r)).toBe('open');
    vi.advanceTimersByTime(1);
    expect(panel(r)).toBe('rest');
  });
});
