// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissMarks } from './dismiss-marks';
import { palette } from './palette';
import { createOverlay, type Overlay } from './overlay';
import type { SubmitDetail } from './overlay-submit';
import { openShot } from './shot';
import { grabViewport } from './shot-grab';
import { mountInk } from './shot-ink';
import type { Shape } from './shot-shapes';
import { createShotStep, drawingOf } from './shot-step';
import { CLASS } from './styles';
import { armWidget } from './test-arm';

vi.mock('./shot-ink', () => ({ mountInk: vi.fn() }));
vi.mock('./shot-grab', () => ({ grabViewport: vi.fn() }));

const box: Shape = { tool: 'box', from: { x: 5, y: 6 }, to: { x: 50, y: 60 } };
const SEND = '[data-act="send"]';
const noop = (): void => undefined;
const flush = () => new Promise((done) => setTimeout(done));
const scope = globalThis as { __passback?: unknown };
type Addon = Parameters<typeof dismissMarks>[0];
const overlays: Overlay[] = [];
let shapes: Shape[] = [];
let change: (count: number) => void = noop;
let addonCtx: Addon | undefined;
const setShapes = (next: Shape[]) => ((shapes = next), change(next.length));
let resolve: (value?: unknown) => void = noop;
const hold = () => new Promise((done) => (resolve = done));
const release = () => (resolve(), flush());
const ok = () => Promise.resolve();
let ready: () => Promise<unknown>;

beforeEach(() => {
  vi.resetAllMocks();
  ready = ok;
  const ink = { tool: 'arrow', shapes: () => shapes, setActive: noop, destroy: noop };
  Object.assign(ink, { undo: () => setShapes(shapes.slice(0, -1)), clear: () => setShapes([]) });
  vi.mocked(mountInk).mockImplementation((_r, _w, on) => ((change = on), on(0), ink as never));
  vi.mocked(grabViewport).mockResolvedValue({
    ok: true,
    blob: new Blob(['x']),
    mime: 'image/webp',
    width: 1,
    height: 1,
    masked: 0,
  });
  const addons = [palette, (ctx: Addon) => (addonCtx = ctx)];
  scope.__passback = { shot: openShot, fx: { addons } };
  document.head.innerHTML =
    '<script data-passback-screenshots="true" data-passback-endpoint="/e" data-passback-shot="/shot.js"></script>';
});

afterEach(() => {
  overlays.splice(0).forEach((overlay) => overlay.destroy());
  document.body.innerHTML = document.head.innerHTML = '';
  delete scope.__passback;
});

function setup() {
  shapes = [];
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const env = { doc: document, win: window as never, root, host };
  const step = createShotStep({ ...env, onLoadFailed: noop });
  const sent: SubmitDetail[] = [];
  const onSubmit = (detail: SubmitDetail) => (
    sent.push(detail),
    void step.finish(detail.element).catch(() => undefined)
  );
  const base = { ...env, ready: () => ready(), selectorOf: () => 'div', onSubmit };
  const overlay = createOverlay({ ...base, ...drawingOf(step) });
  overlays.push(overlay);
  armWidget(root);
  const target = document.body.appendChild(document.createElement('div'));
  const q = (selector: string) => root.querySelector<HTMLButtonElement>(selector);
  const click = (selector: string) => (q(selector)!.click(), flush());
  const pin = () =>
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  const type = (value: string) =>
    Object.assign(root.querySelector('textarea')!, { value }).dispatchEvent(new Event('input'));
  const submitMark = (text: string) => (pin(), type(text), click(`.${CLASS.send}`));
  const open = () => (overlay.arm(), step.toggle(true), flush());
  const draw = async () => (await open(), setShapes([...shapes, box]));
  const stamps = () => root.querySelectorAll('.pb-stamp').length;
  return { root, overlay, sent, q, click, pin, type, submitMark, draw, stamps };
}

type Page = ReturnType<typeof setup>;
const expectBody = ({ sent }: Page, at: number): void => {
  expect(sent).toHaveLength(at + 1);
  const body = { comment: 'Drawing on /', selector: 'body', offset: { x: 0, y: 0 }, marks: [] };
  expect(sent[at]).toMatchObject(body);
  expect(sent[at]!.element).toBe(document.body);
};
async function clickSend(s: Page): Promise<void> {
  s.overlay.arm();
  expect(s.q(SEND)!.disabled).toBe(false);
  await s.click(SEND);
}
async function withHistory(relay = true): Promise<Page> {
  const s = setup();
  await s.submitMark('first');
  s.overlay.acked('m1', false, undefined, { relay });
  await s.draw();
  return s;
}

describe('drawing-only Send after pins and history', () => {
  it('sends a drawing after an empty pin is escaped', async () => {
    const s = setup();
    await s.draw();
    s.pin();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await clickSend(s);
    expectBody(s, 0);
  });

  it('sends a drawing after an empty pin is closed with the ball', async () => {
    const s = setup();
    await s.draw();
    s.pin();
    armWidget(s.root);
    expect([s.overlay.phase(), s.q(`.${CLASS.dot}`)]).toEqual(['idle', null]);
    await clickSend(s);
    expectBody(s, 0);
  });

  it('sends a drawing with acknowledged mark history', async () => {
    for (const relay of [true, false]) {
      const s = await withHistory(relay);
      if (!relay) s.overlay.status({ markId: 'm1', state: 'failed' });
      await clickSend(s);
      expectBody(s, 1);
      // The acknowledged mark stays until it is dismissed.
      expect(s.root.querySelectorAll(`.${CLASS.dot}`)).toHaveLength(1);
      s.overlay.destroy();
    }
  });

  it('sends a drawing after Clear sent removes its previous owner', async () => {
    const s = await withHistory();
    dismissMarks(addonCtx!);
    await s.click('[data-act="clear-sent"]');
    expect(s.q(`.${CLASS.dot}`)).toBeNull();
    await clickSend(s);
    expectBody(s, 1);
  });

  it('labels drawing Send all and celebrates acknowledgement without a text bubble', async () => {
    const s = setup();
    await s.draw();
    const button = s.q(SEND)!;
    const label = s.root.getElementById(button.getAttribute('aria-labelledby')!)!.textContent;
    expect([button.textContent, label, button.title]).toEqual(['Send all', 'Send all', 'Send all']);
    expect(button.getAttribute('part')).toBe('tool tool-send');
    await s.click(SEND);
    // The shot has finished and closed by now; the celebration still has to appear.
    expect([s.q(SEND), s.stamps()]).toEqual([null, 0]);
    s.overlay.acked('d1', false, 'Screenshot attached');
    expect(s.q('.pb-stamp')!.textContent).toBe('SENT!');
    expect(s.q(`.${CLASS.hint}, .${CLASS.outline}`)).toBeNull();
    expect(s.q(`.${CLASS.bubble}`)?.hidden ?? true).toBe(true);
    [s.overlay.arm, s.pin, s.overlay.arm].forEach((act) => act()); // re-arming settles an empty pin
    await s.draw();
    await clickSend(s);
    expectBody(s, 1);
  });

  it('preserves composition and retry guards after acknowledged history', async () => {
    const u = await withHistory();
    // Undo and Clear all remove the last shape: the control is off and a click sends nothing.
    for (const act of ['undo', 'clear']) {
      await u.click(`[data-act="${act}"]`);
      expect(u.q(SEND)!.disabled).toBe(true);
      await u.click(SEND);
      expect(u.sent).toHaveLength(1);
      await u.draw();
    }
    // An unacknowledged mark owns the page while pending, after handoff and after failing.
    ready = hold;
    await u.submitMark('second');
    expect(u.q(SEND)).toBeNull();
    await release();
    expect([u.sent.length, u.q(SEND)]).toEqual([2, null]);
    u.overlay.failed('upload rejected');
    expect([u.q(`.${CLASS.send}`)!.textContent, u.q(SEND)]).toEqual(['Retry', null]);
    ready = ok;
    await u.click(`.${CLASS.send}`);
    expect(u.sent).toHaveLength(3);
    u.overlay.acked('m2', false, undefined, { relay: true });
    // A drawing's readiness and submission failures keep Retry and never celebrate.
    await u.draw();
    const stamped = u.stamps();
    ready = () => Promise.reject(new Error('not ready'));
    await u.click(SEND);
    expect(u.root.textContent).toContain('not ready');
    ready = hold;
    const retry = u.q(`.${CLASS.send}`)!;
    expect(retry.textContent).toBe('Retry');
    [retry, retry].forEach((button) => button.click());
    await release();
    expectBody(u, 3);
    u.overlay.failed('upload rejected');
    expect([u.q(`.${CLASS.send}`)!.textContent, u.stamps()]).toEqual(['Retry', stamped]);
    ready = ok;
    await u.click(`.${CLASS.send}`);
    expectBody(u, 4);
    u.overlay.acked('d1', false);
    expect(u.stamps()).toBe(stamped + 1);
    // A current composition, then a kept comment, own the page.
    await u.draw();
    u.pin();
    expect(u.q(SEND)).toBeNull();
    u.type('kept');
    await u.click('button[data-role="add-more"]');
    expect([u.overlay.phase(), u.q(SEND)]).toEqual(['armed', null]);
    u.overlay.destroy();
    // Disposal before readiness resolves: no batch and no celebration.
    const v = setup();
    ready = hold;
    await v.draw();
    await v.click(SEND);
    v.overlay.destroy();
    await release();
    expect([v.sent, v.stamps()]).toEqual([[], 0]);
  });
});
