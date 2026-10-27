// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolveTarget } from '@passback/collectors';
import type { Collector, CollectOptions } from './collect';
import { collect } from './collect';
import { HOST_ATTRIBUTE } from './mount';
import { createOverlay } from './overlay';
import type { OpenOverlayMark } from './overlay-reattach';
import type { Reattached } from './reattach';
import type { SendResult } from './send';
import type { ShotOutcome } from './shot-loader';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import type { Widget } from './index';

type Passback = { autoStart: boolean; collect?: unknown; shot?: unknown };

const TARGET = { selectors: [], tag: 'div', text: '' } as unknown as ResolveTarget;
const OK: SendResult = { ok: true, id: 'mark-9', trimmed: false };
const NOTE = 'Screenshot not attached';

function setPassback(value: Passback): void {
  (window as unknown as { __passback?: Passback }).__passback = value;
}

function fakeCollector(relay: boolean, send: () => Promise<SendResult>): Collector {
  return {
    relay,
    send: vi.fn(send),
    selectorOf: () => '#save',
    targetOf: () => TARGET,
    reresolve: () => null,
    dispose: vi.fn(),
  };
}

let widgets: Widget[] = [];

async function startWidget(): Promise<ShadowRoot> {
  const { start } = await import('./index');
  widgets.push(start());
  return document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`)!.shadowRoot!;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function pin(root: ShadowRoot, comment: string): void {
  armWidget(root);
  const target = document.createElement('div');
  document.body.appendChild(target);
  target.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
  target.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: 15,
      clientY: 27,
    }),
  );
  const inputs = root.querySelectorAll<HTMLTextAreaElement>(`.${CLASS.input}`);
  const input = inputs[inputs.length - 1]!;
  input.value = comment;
  input.dispatchEvent(new Event('input'));
}

async function submit(root: ShadowRoot, comment: string): Promise<void> {
  pin(root, comment);
  const inputs = root.querySelectorAll<HTMLTextAreaElement>(`.${CLASS.input}`);
  inputs[inputs.length - 1]!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  await settle();
}

const bubbleOf = (root: ShadowRoot): HTMLElement => root.querySelector(`.${CLASS.bubble}`)!;
const dotOf = (root: ShadowRoot): Element => root.querySelector(`.${CLASS.dot}`)!;
const badgeOf = (root: ShadowRoot): HTMLElement =>
  root.querySelector<HTMLElement>(`.${CLASS.launcher} span`)!;

function expectSent(root: ShadowRoot, note?: string): void {
  expect(bubbleOf(root).hidden).toBe(note === undefined);
  expect(bubbleOf(root).textContent).not.toContain('Sent!');
  if (note !== undefined) expect(bubbleOf(root).textContent).toContain(note);
  expect(dotOf(root).getAttribute('data-state')).toBe('sent');
  expect(root.querySelector('.pb-stamp')?.textContent).toBe('SENT!');
  expect(badgeOf(root).hasAttribute('hidden')).toBe(true);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  widgets = [];
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete (window as unknown as { __passback?: Passback }).__passback;
  vi.restoreAllMocks();
});

describe('relay acknowledgement', () => {
  it('derives relay solely from the absence of hot', () => {
    const hot = { send: vi.fn(), on: vi.fn(), off: vi.fn() };
    const cases = [
      { hot, endpoint: undefined, relay: false },
      { hot, endpoint: '/passback', relay: false },
      { hot: undefined, endpoint: '/passback', relay: true },
      { hot: undefined, endpoint: undefined, relay: true },
    ];
    for (const { hot: h, endpoint, relay } of cases) {
      const collector = collect({ win: window, hot: h, endpoint, onStatus: () => undefined });
      expect(collector.relay).toBe(relay);
      collector.dispose();
    }
  });

  it('reports relay success as a hidden bubble and a Sent stamp, with and without a note', async () => {
    for (const note of [undefined, NOTE]) {
      vi.resetModules();
      document.head.innerHTML = '';
      const script = document.createElement('script');
      script.setAttribute('data-passback-endpoint', '/__passback/mark');
      script.setAttribute('data-passback-shot', '/shot.js');
      script.setAttribute('data-passback-screenshots', 'true');
      document.head.appendChild(script);
      const session = {
        setActive: vi.fn(),
        count: vi.fn(() => 1),
        finish: vi.fn(async (): Promise<ShotOutcome> => (note ? { note, annotations: [] } : {})),
        close: vi.fn(),
      };
      const trimmed = note === undefined;
      const collector = fakeCollector(true, async () => ({ ok: true, id: 'mark-9', trimmed }));
      setPassback({ autoStart: false, collect: () => collector, shot: () => session });
      const root = await startWidget();
      pin(root, 'hi');
      root.querySelector<HTMLButtonElement>('[data-role="draw"]')?.click();
      await settle();
      root
        .querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        );
      await settle();
      expectSent(root, note);
      expect(widgets[widgets.length - 1]).toBeDefined();
      await settle();
      expectSent(root, note);
      widgets.forEach((widget) => widget.stop());
      widgets = [];
      document.body.innerHTML = '';
    }
  });

  it('records sent for relay acknowledgement bookkeeping', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const overlay = createOverlay({
      doc: document,
      root,
      host,
      selectorOf: () => 'div',
      targetOf: () => TARGET,
      onSubmit: vi.fn(),
    });
    pin(root, 'hi');
    root
      .querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    overlay.acked('m1', false, undefined, { relay: true });
    expectSent(root);
    expect(overlay.phase()).toBe('idle');
    const mark: OpenOverlayMark = overlay.openMarks()[0]!;
    expect(mark.id).toBe('m1');
    const view = { kind: 'restored' } as const;
    const lost: Reattached<OpenOverlayMark> = { mark, element: null, orphaned: true };
    overlay.reattach([lost], view);
    expect(dotOf(root).getAttribute('data-state')).toBe('orphaned');
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 1, top: 2 }) as DOMRect;
    overlay.reattach([{ mark, element: el, orphaned: false }], view);
    expect(dotOf(root).getAttribute('data-state')).toBe('sent');
    overlay.destroy();
  });

  it('preserves agent acknowledgements and status progression', async () => {
    let onStatus: CollectOptions['onStatus'] = () => undefined;
    setPassback({
      autoStart: false,
      collect: (opts: CollectOptions) => {
        onStatus = opts.onStatus;
        return fakeCollector(false, async () => OK);
      },
    });
    const root = await startWidget();
    await submit(root, 'hi');
    expect(bubbleOf(root).textContent).toContain('Waiting for the agent');
    expect(dotOf(root).getAttribute('data-state')).toBe('queued');
    const status = (state: string) =>
      onStatus({ v: 1, markId: 'mark-9', state } as Parameters<CollectOptions['onStatus']>[0]);
    status('running');
    expect(dotOf(root).getAttribute('data-state')).toBe('running');
    status('done');
    expect(dotOf(root).getAttribute('data-state')).toBe('done');
    expect(root.querySelector('.pb-stamp')?.textContent).toBe('FIXED ✓');

    widgets[0]!.acked('direct-1', false);
    expect(bubbleOf(root).textContent).toContain('Waiting for the agent');
    expect(bubbleOf(root).getAttribute('data-mark-id')).toBe('direct-1');

    const second = await startWidget();
    await submit(second, 'again');
    status('failed');
    expect(root.querySelector(`.${CLASS.dot}[data-state="failed"]`)).not.toBeNull();
  });

  it('keeps relay send failures retryable until acknowledgement', async () => {
    const sends: Array<() => Promise<SendResult>> = [
      async () => ({ ok: false, reason: 'rejected', message: 'nope' }),
      () => Promise.reject(new Error('boom')),
      async () => OK,
    ];
    const collector = fakeCollector(true, () => sends.shift()!());
    setPassback({ autoStart: false, collect: () => collector });
    const root = await startWidget();
    await submit(root, 'hi');
    expect(bubbleOf(root).textContent).toContain('nope');
    expect(bubbleOf(root).hidden).toBe(false);
    const retry = () => root.querySelector<HTMLButtonElement>(`.${CLASS.send}`)!;
    expect(retry().textContent).toBe('Retry');
    retry().click();
    await settle();
    expect(bubbleOf(root).textContent).toContain('boom');
    expect(bubbleOf(root).hidden).toBe(false);
    retry().click();
    await settle();
    expectSent(root);
  });

  it('R4 keeps two local work animations and comments independent', async () => {
    let onStatus: CollectOptions['onStatus'] = () => undefined;
    let n = 0;
    setPassback({
      autoStart: false,
      collect: (opts: CollectOptions) => {
        onStatus = opts.onStatus;
        return fakeCollector(false, async () => ({ ok: true, id: `m${++n}`, trimmed: false }));
      },
    });
    const root = await startWidget();
    await submit(root, 'one');
    await submit(root, 'two');
    const dots = (): Element[] => [...root.querySelectorAll(`.${CLASS.dot}`)];
    const state = (i: number): string | null => dots()[i]!.getAttribute('data-state');
    const status = (markId: string, st: string, message?: string) =>
      onStatus({ v: 1, markId, state: st, message } as Parameters<CollectOptions['onStatus']>[0]);
    expect([state(0), state(1)]).toEqual(['queued', 'queued']);
    status('m1', 'running', 'building');
    status('nope', 'done');
    expect([state(0), state(1)]).toEqual(['running', 'queued']);
    status('m1', 'done');
    expect([state(0), state(1)]).toEqual(['done', 'queued']);
    expect([...root.querySelectorAll('.pb-stamp')].map((s) => s.textContent)).toEqual(['FIXED ✓']);
    status('m2', 'failed', 'boom');
    expect(state(1)).toBe('failed');
    const css = root.querySelector('style')?.textContent ?? '';
    for (const s of ['queued', 'running', 'sending'])
      expect(css).toContain(`[data-state="${s}"]::after`);
    expect(css).not.toContain('[data-state="done"]::after');
    expect(css).not.toContain('[data-state="failed"]::after');
    expect(css).not.toContain('[data-state="orphaned"]::after');
  });
});
