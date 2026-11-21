// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keptReducer } from './kept';
import type { Overlay } from './overlay';
import type { BatchOutcome, SubmitAllDetail } from './send-batch';
import { createOverlay } from './overlay';
import { sendAll, type SendAllCtx } from './send-all';
import { CLASS } from './styles';

const scope = globalThis as { __passback?: { filed?: () => unknown } };
let overlays: Overlay[] = [];
let captured: SendAllCtx;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  delete scope.__passback;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function setup() {
  const grab = (ctx: unknown): void => void (captured = ctx as SendAllCtx);
  scope.__passback = { fx: { addons: [sendAll, grab] } } as never;
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const batches: SubmitAllDetail[] = [];
  host.addEventListener('passback:submit-all', (event) =>
    batches.push((event as CustomEvent<SubmitAllDetail>).detail),
  );
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn(),
    drawing: { toggle: vi.fn(), cancel: vi.fn() },
  });
  overlays.push(overlay);
  return { host, root, overlay, batches };
}
type R = ReturnType<typeof setup>;

function keepAll(r: R, ...texts: string[]): void {
  r.overlay.arm();
  for (const text of texts) {
    const target = document.body.appendChild(document.createElement('div'));
    target.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
    );
    const input = r.root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    r.root.querySelector<HTMLElement>('[data-role="add-more"]')!.click();
  }
  r.host.setAttribute('data-pb-panel', 'open');
}

const toTracker = (...ns: number[]): void => {
  for (const n of ns)
    captured.state.kept = keptReducer(captured.state.kept, { type: 'dest', n, dest: 'tracker' });
};
const sendTo = (r: R, dest?: 'agent' | 'tracker'): void =>
  void r.host.dispatchEvent(
    dest === undefined
      ? new Event('passback:send-all')
      : new CustomEvent('passback:send-all', { detail: { dest } }),
  );
const texts = (r: R, i: number) => r.batches[i]!.details.map((d) => d.comment);
const ok = (ids: string[], relay = true): BatchOutcome => ({
  ok: true,
  ids,
  trimmed: ids.map(() => false),
  notes: ids.map(() => undefined),
  relay,
});
const kept = () => captured.state.kept.items.map((i) => i.comment);
const dots = (r: R) =>
  [...r.root.querySelectorAll<HTMLElement>(`.${CLASS.dot}`)].map((d) => d.dataset.n);
const filed = () => scope.__passback?.filed?.();

describe('send by destination', () => {
  it('a send-all event without a detail sends only the agent comments and leaves the tracker ones kept', () => {
    const r = setup();
    keepAll(r, 'a', 'b', 'c');
    toTracker(2);
    sendTo(r);
    expect(r.batches).toHaveLength(1);
    expect(r.batches[0]!.dest).toBe('agent');
    expect(texts(r, 0)).toEqual(['a', 'c']);
    r.batches[0]!.settle(ok(['i1', 'i2']));
    expect(kept()).toEqual(['b']);
    expect(captured.state.kept.items[0]!.dest).toBe('tracker');
  });

  it('a send-all event for the tracker sends only the tracker comments with dest tracker on the submit-all detail', () => {
    const r = setup();
    keepAll(r, 'a', 'b', 'c');
    toTracker(2, 3);
    sendTo(r, 'tracker');
    expect(r.batches[0]!.dest).toBe('tracker');
    expect(texts(r, 0)).toEqual(['b', 'c']);
    r.batches[0]!.settle(ok(['T-1', 'T-2']));
    expect(kept()).toEqual(['a']);
  });

  it('numbers each sent comment as its dot reads in the whole list and renumbers the dots left behind', () => {
    const r = setup();
    keepAll(r, 'a', 'b', 'c');
    toTracker(2);
    sendTo(r);
    const { details } = r.batches[0]!;
    expect(details.map((d) => d.marks!.map((m) => [m.n, m.current]))).toEqual([
      [
        [1, true],
        [3, false],
      ],
      [
        [1, false],
        [3, true],
      ],
    ]);
    r.batches[0]!.settle(ok(['i1', 'i2']));
    const left = captured.state.kept.items[0]!.mark.dot.element;
    expect(left.dataset.n).toBe('1');
    expect(dots(r)).toContain('1');
  });

  it('a failed tracker batch keeps every comment and the retry sends the same tracker comments again', () => {
    const r = setup();
    keepAll(r, 'a', 'b');
    toTracker(2);
    sendTo(r, 'tracker');
    r.batches[0]!.settle({ ok: false, message: 'boom' });
    expect(kept()).toEqual(['a', 'b']);
    [...r.root.querySelectorAll<HTMLElement>('button')]
      .find((b) => b.textContent === 'Retry')!
      .click();
    expect(r.batches).toHaveLength(2);
    expect(r.batches[1]!.dest).toBe('tracker');
    expect(texts(r, 1)).toEqual(['b']);
    expect(filed()).toEqual([]);
  });

  it('a tracker send with no tracker comment does nothing', () => {
    const r = setup();
    keepAll(r, 'a');
    sendTo(r, 'tracker');
    expect(r.batches).toHaveLength(0);
    expect(kept()).toEqual(['a']);
    expect(r.overlay.phase()).toBe('armed');
  });

  it('records the comment and the returned reference of every filed comment and nothing for an agent batch', () => {
    const r = setup();
    keepAll(r, 'a', 'b', 'c');
    toTracker(2, 3);
    expect(filed()).toEqual([]);
    sendTo(r);
    r.batches[0]!.settle(ok(['i1']));
    expect(filed()).toEqual([]);
    sendTo(r, 'tracker');
    r.batches[1]!.settle(ok(['T-1', 'T-2']));
    expect(filed()).toEqual([
      { comment: 'b', ref: 'T-1' },
      { comment: 'c', ref: 'T-2' },
    ]);
  });

  it('removes the filed getter on dispose', () => {
    const r = setup();
    expect(typeof scope.__passback?.filed).toBe('function');
    r.host.dispatchEvent(new Event('passback:dispose'));
    expect(scope.__passback?.filed).toBeUndefined();
  });
});
