// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolveTarget } from '@passback/collectors';
import { createBubble } from './bubble-view';
import type { Collector } from './collect';
import { HOST_ATTRIBUTE } from './mount';
import { createOverlay } from './overlay';
import type { SendResult } from './send';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import type { Widget } from './index';

type Passback = { autoStart: boolean; collect?: unknown };
type Pending = { resolve: (r: SendResult) => void; reject: (e: Error) => void };

const TARGET = { selectors: [], tag: 'div', text: '' } as unknown as ResolveTarget;
const NOTE = 'Screenshot attached';
const noop = (): void => undefined;

let widgets: Widget[] = [];
let pendings: Pending[] = [];

function pendingCollector(): Collector {
  return {
    relay: true,
    send: vi.fn(
      () =>
        new Promise<SendResult>((resolve, reject) => {
          pendings.push({ resolve, reject });
        }),
    ),
    selectorOf: () => '#save',
    targetOf: () => TARGET,
    reresolve: () => null,
    dispose: vi.fn(),
  };
}

async function startWidget(): Promise<ShadowRoot> {
  (window as unknown as { __passback?: Passback }).__passback = {
    autoStart: false,
    collect: () => pendingCollector(),
  };
  const { start } = await import('./index');
  widgets.push(start());
  return document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`)!.shadowRoot!;
}

function overlayIn(): { root: ShadowRoot; overlay: ReturnType<typeof createOverlay> } {
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: () => 'div',
    targetOf: () => TARGET,
    onSubmit: vi.fn(),
  });
  return { root, overlay };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function submit(root: ShadowRoot, comment: string): void {
  armWidget(root);
  const target = document.body.appendChild(document.createElement('div'));
  target.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
  );
  const inputs = root.querySelectorAll<HTMLTextAreaElement>(`.${CLASS.input}`);
  const input = inputs[inputs.length - 1]!;
  input.value = comment;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
}

const bubbles = (root: ShadowRoot): HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>(`.${CLASS.bubble}`),
];
const state = (root: ShadowRoot, i: number): string | null =>
  root.querySelectorAll(`.${CLASS.dot}`)[i]!.getAttribute('data-state');
const stamps = (root: ShadowRoot): (string | null)[] =>
  [...root.querySelectorAll('.pb-stamp')].map((s) => s.textContent);
const hint = (bubble: HTMLElement): Element | null => bubble.querySelector('[data-role="hint"]');

function expectQuiet(bubble: HTMLElement): void {
  expect(bubble.hidden).toBe(true);
  expect(hint(bubble)).toBeNull();
  expect(bubble.textContent).not.toContain(NOTE);
}

function expectFailed(root: ShadowRoot, message: string): void {
  const bubble = bubbles(root)[0]!;
  expect(state(root, 0)).toBe('failed');
  expect(bubble.hidden).toBe(false);
  expect(bubble.textContent).toContain(`Not sent: ${message}`);
  expect(bubble.textContent).toContain('Your comment is kept.');
  expect(bubble.querySelector(`.${CLASS.send}`)?.textContent).toBe('Retry');
}

beforeEach(() => {
  vi.resetModules();
  pendings = [];
});

afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  widgets = [];
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete (window as unknown as { __passback?: Passback }).__passback;
  vi.restoreAllMocks();
});

describe('feedback after sending', () => {
  it('ignores notes after Sent and preserves agent acknowledgement notes', () => {
    const { root, overlay } = overlayIn();
    submit(root, 'hi');
    const sent = bubbles(root)[0]!;
    expect(state(root, 0)).toBe('sending');
    expect(sent.hidden).toBe(true);
    overlay.acked('m1', false, NOTE, { relay: true });
    for (const text of [NOTE, 'Screenshot not attached', NOTE]) {
      overlay.acked('m1', false, text, { relay: true });
      expect(state(root, 0)).toBe('sent');
      expect(sent.getAttribute('data-state')).toBe('sent');
      expectQuiet(sent);
    }
    overlay.destroy();

    const queued = createBubble(root, { anchor: { x: 1, y: 2 }, onSend: noop, onCancel: noop });
    queued.showAcked('m2', true);
    queued.showNote(NOTE);
    queued.showNote('Screenshot not attached');
    expect(queued.element.hidden).toBe(false);
    expect([...queued.element.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'Sent. Waiting for the agent.',
      'Trimmed to fit the size limit.',
      'Screenshot not attached',
    ]);
    expect(hint(queued.element)?.textContent).toBe('Screenshot not attached');
  });

  it('uses the internal sending arc through failure and Retry', async () => {
    const root = await startWidget();
    submit(root, 'hi');
    await settle();
    const css = root.querySelector('style')!.textContent!.replace(/\s+/g, ' ');
    const shared = css.indexOf(`.${CLASS.dot}[data-state="sending"]::after,`);
    const internal = css.lastIndexOf(`.${CLASS.dot}[data-state="sending"]::after { inset: 3px; }`);
    expect(shared).toBeGreaterThan(-1);
    expect(css.slice(shared, internal)).toContain('inset: -8px');
    expect(internal).toBeGreaterThan(shared);
    expect(state(root, 0)).toBe('sending');
    expect(bubbles(root)[0]!.hidden).toBe(true);
    expect(pendings).toHaveLength(1);

    pendings[0]!.resolve({ ok: false, reason: 'rejected', message: 'nope' } as SendResult);
    await settle();
    expectFailed(root, 'nope');

    bubbles(root)[0]!.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!.click();
    await settle();
    expect(state(root, 0)).toBe('sending');
    expect(pendings).toHaveLength(2);
    pendings[1]!.reject(new Error('boom'));
    await settle();
    expectFailed(root, 'boom');

    bubbles(root)[0]!.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!.click();
    await settle();
    expect(state(root, 0)).toBe('sending');
    pendings[2]!.resolve({ ok: true, id: 'm1', trimmed: false });
    await settle();
    expect(state(root, 0)).toBe('sent');
    expectQuiet(bubbles(root)[0]!);
    expect(stamps(root)).toEqual(['SENT!']);
  });

  it('keeps Sent feedback independent between marks', async () => {
    const root = await startWidget();
    submit(root, 'one');
    await settle();
    pendings[0]!.resolve({ ok: true, id: 'm1', trimmed: false });
    await settle();
    submit(root, 'two');
    await settle();
    expect([state(root, 0), state(root, 1)]).toEqual(['sent', 'sending']);
    expect(stamps(root)).toEqual(['SENT!']);
    const [first, second] = bubbles(root);
    expectQuiet(first!);
    expect(second!.hidden).toBe(true);
    pendings[1]!.resolve({ ok: true, id: 'm2', trimmed: false });
    await settle();
    expect([state(root, 0), state(root, 1)]).toEqual(['sent', 'sent']);
    expect(stamps(root)).toEqual(['SENT!', 'SENT!']);
    for (const bubble of [first!, second!]) expectQuiet(bubble);

    const opts = { anchor: { x: 1, y: 2 }, onSend: noop, onCancel: noop };
    const sent = createBubble(root, opts);
    const pending = createBubble(root, opts);
    sent.showSent();
    pending.setPending();
    sent.showNote(NOTE);
    expectQuiet(sent.element);
    expect(sent.element.getAttribute('data-state')).toBe('sent');
    expectQuiet(pending.element);
    expect(pending.element.getAttribute('data-state')).toBe('sending');
  });
});
