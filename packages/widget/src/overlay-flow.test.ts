// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { transition, type FlowEvent, type FlowState } from './overlay-flow';
import { KEPT_FULL_NOTE, keepHandler } from './overlay-marks';
import { createOverlay, type Overlay, type OverlayOptions } from './overlay';
import type { SubmitDetail } from './overlay-submit';
import { drawingOf, type ShotStep } from './shot-step';

vi.mock('./overlay-marks', async (load) => {
  const real = await load<typeof import('./overlay-marks')>();
  return { ...real, keepHandler: vi.fn(real.keepHandler) };
});

const EVENTS =
  'arm pin drawOn drawOff send acked failed cancel park reopen addMark hide show discard'.split(' ');
// Next state per event in EVENTS order; '-' is illegal.
const EXPECTED: Record<FlowState, string> = {
  idle: 'armed - - - - idle - - - - - hidden - -',
  armed: '- composing - - - - - idle - - - hidden - -',
  composing: '- - drawing - sending - - idle composing composing armed hidden - idle',
  drawing: '- - - composing sending - - idle composing - armed hidden - idle',
  sending: '- - - - sending idle sending - sending sending - hidden - -',
  hidden: '- - - - - - - - - - - - idle -',
};
const DRAFTS = ['note|keep', 'note|arm', '|arm', '  |arm'].map((c) => c.split('|'));

let live: Overlay | undefined;
const seq = (...steps: unknown[]) => steps;
function setup(extra: Partial<OverlayOptions> = {}) {
  live?.destroy();
  document.body.innerHTML = '<div></div><p></p>';
  const host = document.querySelector('div')!;
  const root = host.attachShadow({ mode: 'open' });
  const [onSubmit, drawing] = [vi.fn(), { toggle: vi.fn(), cancel: vi.fn() }];
  const opts = { doc: document, root, host, selectorOf: () => 'p', onSubmit, drawing, ...extra };
  const overlay = (live = createOverlay(opts));
  const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const key = (k: string) => q('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  const pin = (text: string) => {
    overlay.arm();
    document.querySelector('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    Object.assign(q('textarea'), { value: text }).dispatchEvent(new Event('input'));
  };
  const pencil = () => q('[data-role="draw"]').click();
  const keep = () => q('[data-role="add-more"]').click();
  // phase|attribute|draft text|dot numbers|pencil pressed, '-' where absent.
  const look = () =>
    [overlay.phase(), host.getAttribute('data-passback-phase')]
      .concat(root.querySelector('textarea')?.value ?? '-')
      .concat([...root.querySelectorAll('.pb-dot')].map((d) => d.getAttribute('data-n')).join(','))
      .concat(root.querySelector('[data-role="draw"]')?.getAttribute('aria-pressed') ?? '-')
      .join('|');
  return { root, onSubmit, drawing, overlay, q, key, pin, pencil, keep, look };
}

it('covers all 84 overlay transition cells', () => {
  const rows = Object.entries(EXPECTED) as [FlowState, string][];
  const cells = rows.flatMap(([s, row]) => row.split(' ').map((n, i) => [s, EVENTS[i], n]));
  expect(cells).toHaveLength(84);
  for (const [s, e, n] of cells as [FlowState, FlowEvent, string][]) {
    const { state, ok, effects } = transition(s, e);
    expect([state, ok], `${s} + ${e}`).toEqual([n === '-' ? s : n, n !== '-']);
    if (!ok) expect(effects).toEqual([]);
  }
});

it('settles addMark drafts before rearming with drawing off', () => {
  for (const draw of [false, true])
    for (const [text, via] of DRAFTS) {
      const r = setup();
      seq(r.pin(text!), draw && r.pencil(), via === 'keep' ? r.keep() : r.overlay.arm());
      const kept = vi.mocked(keepHandler).mock.lastCall?.[0].state.kept.items ?? [];
      const want = text === 'note' ? [['note', 'p', r.q('.pb-dot')]] : [];
      expect(r.look()).toBe(`armed|armed|-|${want.length ? '1' : ''}|-`);
      expect(kept.map((k) => [k.comment, k.selector, k.mark.dot.element])).toEqual(want);
      expect([r.drawing.cancel.mock.calls.length, r.onSubmit.mock.calls.length]).toEqual([1, 0]);
    }
});

it('preserves a full kept-list draft and stops drawing', () => {
  const r = setup();
  for (let n = 0; n < 20; n++) seq(r.pin(`c${n}`), r.keep());
  seq(r.pin('full'), r.pencil(), r.overlay.arm());
  expect(r.drawing.toggle.mock.calls).toEqual([[true], [false]]);
  expect(r.drawing.cancel).toHaveBeenCalledTimes(20);
  const dots = Array.from({ length: 20 }, (_, i) => i + 1).join(',');
  expect(r.look()).toBe(`composing|composing|full|${dots},|false`);
  expect(r.root.textContent).toContain(KEPT_FULL_NOTE);
});

it('applies drawing effects once across cancel send and destroy', async () => {
  // A fake ShotStep: drawing buffers a shape, close drops it, finish hands it on.
  const shapes: string[] = [];
  const close = vi.fn(() => void shapes.splice(0));
  const finish = vi.fn(async () => ({ annotations: shapes.splice(0) }));
  const toggle = (on: boolean) => void (on && shapes.push('arrow'));
  const step = { enabled: true, toggle, close, finish } as unknown as ShotStep;
  const onSubmit = vi.fn((d: SubmitDetail) => void step.finish(d.element));
  let r = setup({ ...drawingOf(step), onSubmit });
  seq(r.pin('a'), r.pencil(), r.pencil(), r.key('Escape'));
  expect([close.mock.calls.length, shapes]).toEqual([1, []]);
  // The dismissed draft 'a' would be kept by the next arm, and Enter would then mean Send all.
  r = setup({ ...drawingOf(step), onSubmit });
  seq(r.pin('b'), r.pencil(), r.key('Enter'), r.overlay.destroy(), r.overlay.destroy());
  expect(close).toHaveBeenCalledTimes(1);
  await expect(finish.mock.results[0]?.value).resolves.toEqual({ annotations: ['arrow'] });
  let release = () => {};
  const ready = () => new Promise<void>((done) => (release = done));
  r = setup({ ...drawingOf(step), onSubmit, ready });
  seq(r.pin('c'), r.pencil(), r.key('Enter'), r.overlay.destroy(), r.overlay.destroy());
  seq(release(), await new Promise((done) => setTimeout(done)));
  expect([finish.mock.calls.length, onSubmit.mock.calls.length, close.mock.calls.length]).toEqual([
    1, 1, 1,
  ]);
  r = setup();
  seq(r.pin('c'), r.overlay.setDrawing(true));
  expect(r.look()).toBe('composing|composing|c||true');
  seq(r.overlay.destroy(), r.overlay.destroy());
  expect([r.drawing.toggle.mock.calls.length, r.drawing.cancel.mock.calls.length]).toEqual([0, 1]);
});

it('routes failure retry and late callbacks through the overlay flow', async () => {
  let release = () => {};
  const ready = vi.fn(() => new Promise<void>((done) => (release = done)));
  const r = setup({ ready });
  seq(r.pin('hi'), r.key('Enter'), release());
  seq(await new Promise((done) => setTimeout(done)), r.overlay.failed('boom'));
  expect(r.look()).toMatch(/^sending\|sending\|/);
  seq(r.q('button.pb-send').click(), r.q('button.pb-send').click());
  expect(r.onSubmit.mock.calls).toEqual([r.onSubmit.mock.calls[0], r.onSubmit.mock.calls[0]]);
  const late = setup({ ready });
  seq(late.pin('late'), late.key('Enter'), late.overlay.destroy(), late.overlay.failed('x'));
  seq(release(), await new Promise((done) => setTimeout(done)), late.overlay.acked('y', false));
  expect([late.onSubmit.mock.calls.length, late.look()]).toEqual([0, 'idle|idle|-||-']);
});

it('R1 covers dismissal transitions and effects for every flow state', () => {
  // cancel|park|reopen effects per state; rejected moves carry none (legality is in EXPECTED).
  const of = (s: string) =>
    ['cancel', 'park', 'reopen'].map((e) => transition(s as FlowState, e as FlowEvent).effects);
  const want = '|| || abandon,settle|| abandon,settle|off| || ||';
  expect(
    Object.keys(EXPECTED)
      .map((s) => of(s).join('|'))
      .join(' '),
  ).toBe(want);
  // Destruction stays terminal: hide abandons a draft without keeping it.
  expect(transition('drawing', 'hide')).toMatchObject({ state: 'hidden', effects: ['abandon'] });
});

it('R3 covers the discard transition and effects for every flow state', () => {
  const states: FlowState[] = ['idle', 'armed', 'composing', 'drawing', 'sending', 'hidden'];
  for (const s of states) {
    const { state, ok, effects } = transition(s, 'discard');
    const live = s === 'composing' || s === 'drawing';
    expect([state, ok, effects.join()], s).toEqual(
      live ? ['idle', true, 'abandon,drop'] : [s, false, ''],
    );
  }
});

it('R3 the trash icon deletes the point and its comment and arms Point again', () => {
  const r = setup();
  seq(r.pin('first'), r.keep(), r.pin('gone'), r.pencil());
  r.q('[data-role="discard"]').click();
  expect(r.look()).toBe('armed|armed|-|1|-');
  expect(r.root.querySelector('.pb-bubble')).toBeNull();
  expect(r.onSubmit).not.toHaveBeenCalled();
  expect(r.drawing.cancel).toHaveBeenCalledTimes(2);
  const kept = vi.mocked(keepHandler).mock.lastCall?.[0].state.kept.items ?? [];
  expect(kept.map((k) => k.comment)).toEqual(['first']);
  seq(r.pin(''));
  r.q('[data-role="discard"]').click();
  expect(r.look()).toBe('armed|armed|-|1|-');
});
