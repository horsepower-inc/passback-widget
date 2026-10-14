// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { MarkRows } from './overlay-mark-rows';
import { createOverlay, type Overlay } from './overlay';
import { sendAll } from './send-all';

// The row model of the overlay under test, to drive rows() and act directly.
let model = {} as MarkRows;
vi.mock('./overlay-mark-rows', async (original) => {
  const real = await original<typeof import('./overlay-mark-rows')>();
  return { ...real, createMarkRows: (ctx: never) => (model = real.createMarkRows(ctx)) };
});

const TARGET = { selectors: [], tag: 'div', text: '' };
const [KEEP, VIEW] = ['[data-role="add-more"]', { kind: 'restored' } as const];
let [overlay, root, sent] = [{} as Overlay, {} as ShadowRoot, vi.fn()];
let settle: { resolve(): void; reject(error: Error): void };
const ready = () => new Promise<void>((resolve, reject) => void (settle = { resolve, reject }));
const scope = globalThis as { __passback?: unknown };
afterEach(() => (overlay.destroy(), delete scope.__passback));

function setup(gate?: typeof ready): void {
  const host = document.body.appendChild(document.createElement('div'));
  root = host.attachShadow({ mode: 'open' });
  const opts = { doc: document, root, host, selectorOf: () => 'div', targetOf: () => TARGET };
  overlay = createOverlay({ ...opts, onSubmit: (sent = vi.fn()), ready: gate });
}

// Pins a target and keeps text; how = 'send' sends it, blank stays composing, other how acks it.
function mark(text: string, how = 'keep'): HTMLElement {
  if (overlay.phase() === 'idle') overlay.arm();
  const target = Object.assign(document.createElement('div'), { scrollIntoView: vi.fn() });
  document.body.appendChild(target).click();
  const input = Object.assign(q<HTMLTextAreaElement>('textarea')!, { value: text });
  input.dispatchEvent(new Event('input'));
  if (how === 'keep') q<HTMLElement>(KEEP)!.click();
  else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  if (how !== 'keep' && how !== 'send') overlay.acked(how, false);
  return target;
}

const q = <E extends Element>(s: string) => root.querySelector<E>(s);
const all = (s: string) => [...root.querySelectorAll<HTMLElement>(s)];
const calls = (fn: object) => (fn as Mock).mock.calls.length;
const trash = (i: number) => all('.pb-list li')[i]!.querySelector('button')!;
const texts = () => String(all('.pb-list li').map((li) => li.textContent));
// The listed comments, the badge and the transport calls.
const panel = () => `${texts()}|${q('.pb-count')!.textContent}|${calls(sent)}`;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const status = (markId: string, state: string) => overlay.status({ markId, state } as never);
const at = (id: string, element: Element | null) =>
  overlay.reattach([{ mark: { id, target: TARGET }, element, orphaned: !element }] as never, VIEW);

describe('mark rows', () => {
  it('R6 lists only unsent comments and Discard all removes them with their dots', () => {
    setup();
    // Single sends come first: with a comment kept, Enter is Send all.
    mark('agent', 'm1');
    (['running', 'done', 'failed'] as const).forEach(
      (s) => (status('m1', s), expect(texts()).toBe('')),
    );
    mark('relay', 'send');
    overlay.acked('m2', false, undefined, { relay: true });
    mark('<img src=x>');
    expect([q('.pb-list span')!.textContent, q('.pb-list img')]).toEqual(['<img src=x>', null]);
    mark('two');
    model.changed();
    expect([texts(), model.rows().map((r) => r.n)]).toEqual(['1<img src=x>,2two', [1, 2]]);
    expect(all('.pb-dot').length).toBe(4);
    q<HTMLElement>('.pb-head button:last-child')!.click();
    expect([model.rows().length, q('.pb-list'), calls(sent)]).toEqual([0, null, 2]);
    expect(String(all('.pb-dot').map((d) => d.dataset.n ?? ''))).toBe(',');
  });

  it('deletes only the selected local mark and ignores its late events', () => {
    setup();
    ['k4', 'k1', 'k2', 'k3'].forEach((text, i) => mark(text, i === 0 ? 'm1' : 'keep'));
    trash(1).click();
    expect(String(all('[data-n]').map((dot) => dot.textContent))).toBe('1,2');
    trash(2 - 1).click();
    status('m1', 'done');
    at('m1', null);
    model.changed();
    expect([overlay.openMarks().length, all('.pb-dot, .pb-stamp').length]).toEqual([1, 2]);
    expect(panel()).toBe('1k1|1|1');
    trash(0).click();
    expect(panel()).toBe('||1');
  });

  it('numbers a new open pin 2 after the first kept comment is deleted', () => {
    setup();
    mark('k1');
    mark('k2');
    trash(0).click();
    expect(String(all('[data-n]').map((dot) => dot.textContent))).toBe('1');
    overlay.arm();
    document.body.appendChild(document.createElement('div')).click();
    expect(all('.pb-dot').map((dot) => dot.textContent).pop()).toBe('2');
  });

  it('locks only the sending row through readiness retry and settlement', async () => {
    // With a comment kept, Enter is Send all: the kept comment goes first, the open one waits.
    scope.__passback = { fx: { addons: [sendAll] } };
    setup(ready);
    mark('k1');
    mark('agent', 'send');
    expect(model.rows().map((r) => r.locked)).toEqual([true, false]);
    settle.reject(new Error('collectors offline'));
    await flush();
    expect(q('.pb-bubble')!.textContent).toContain('collectors offline');
    settle.resolve();
    await flush();
    overlay.failed('network');
    expect(panel()).toBe('1k1,2agent|2|0');
  });

  it('disposes row resources and drops late readiness results', async () => {
    setup(ready);
    mark('agent', 'send');
    overlay.destroy();
    settle.resolve();
    await flush();
    expect([q('.pb-tray, .pb-dot, .pb-bubble'), calls(sent)]).toEqual([null, 0]);
  });
});
