// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLASS } from './styles';
import { TRAY_CLASS } from './tray-view';
import type { Overlay, SubmitDetail } from './overlay';
import { createOverlay } from './overlay';
import { KEPT_FULL_NOTE } from './overlay-marks';

let overlays: Overlay[] = [];

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  document.body.innerHTML = '';
});

function setup(onSubmit: (detail: SubmitDetail) => void = vi.fn(), extra = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit,
    ...extra,
  });
  overlays.push(overlay);
  return { host, root, overlay, onSubmit: vi.mocked(onSubmit) };
}

const ball = (root: ShadowRoot) => root.querySelector<HTMLButtonElement>(`.${CLASS.launcher}`)!;
const closed = (host: HTMLElement) => host.getAttribute('data-pb-panel') === 'closed';
const count = (root: ShadowRoot) => root.querySelector(`.${CLASS.count}`)!.textContent;
const seq = (...steps: unknown[]) => steps;
const st = (...v: unknown[]) => v.join('|');
const n = (root: ShadowRoot, selector: string) => `${root.querySelectorAll(selector).length}`;
const [PIN, CLOSE] = ['Passback: pin a comment', 'Passback: close'];
// phase|panel closed|launcher name|badge|dots|bubbles
const look = ({ root, host, overlay }: ReturnType<typeof setup>) =>
  [overlay.phase(), closed(host), ball(root).getAttribute('aria-label'), count(root)]
    .concat(n(root, `.${CLASS.dot}`), n(root, `.${CLASS.bubble}`))
    .join('|');
const esc = (target: EventTarget, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, ...init }),
  );
const keep = (root: ShadowRoot) =>
  root.querySelector<HTMLElement>('[data-role="add-more"]')!.click();
const rows = (root: ShadowRoot) =>
  Array.from(root.querySelectorAll('.pb-list span'), (s) => s.textContent);

function pressHotkey(): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      code: 'KeyR',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function pin(): void {
  const target = document.createElement('div');
  document.body.appendChild(target);
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
  );
}

function compose(root: ShadowRoot, text: string): HTMLTextAreaElement {
  pin();
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  return input;
}

function send(input: HTMLTextAreaElement): void {
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
}

describe('overlay panel', () => {
  it('R1 arms Point directly and closes from every active mode', () => {
    const drawing = { toggle: vi.fn(), cancel: vi.fn() };
    const r = setup(vi.fn(), { drawing });
    const { root, overlay } = r;
    ball(root).click();
    expect(look(r)).toBe(`armed|false|${CLOSE}||0|0`);
    expect(root.textContent).not.toContain('Add a comment');
    seq(esc(document, { isComposing: true }), esc(document, { keyCode: 229 }));
    expect(overlay.phase()).toBe('armed');
    ball(root).click();
    expect(look(r)).toBe(`idle|true|${PIN}||0|0`);
    seq(ball(root).click(), compose(root, ''));
    expect(look(r)).toBe(`composing|false|${CLOSE}||1|1`);
    seq(ball(root).click(), overlay.arm(), compose(root, 'draw'), overlay.setDrawing(true));
    seq(ball(root).click(), ball(root).click(), ball(root).click());
    expect(look(r)).toBe(`idle|true|${PIN}|1|1|0`);
    expect([drawing.cancel.mock.calls.length, r.onSubmit.mock.calls.length]).toEqual([2, 0]);
  });

  it('R1 dismisses empty bubbles from page and shadow Escape', () => {
    const r = setup();
    for (const [i, target] of [document, r.root, null].entries()) {
      r.overlay.arm();
      const input = compose(r.root, ' '.repeat(i * 2));
      seq(esc(input, { isComposing: true }), esc(input, { keyCode: 229 }));
      expect(r.overlay.phase()).toBe('composing');
      esc(target ?? input);
      expect(look(r)).toBe(`idle|true|${PIN}||0|0`);
    }
    seq(esc(document), r.overlay.arm());
    expect(r.overlay.phase()).toBe('armed');
  });

  it('R1 keeps drafts and existing comments exactly once on dismissal', () => {
    const r = setup();
    const { root } = r;
    r.overlay.arm();
    seq(compose(root, 'first'), keep(root));
    const dot = root.querySelector(`.${CLASS.dot}`);
    compose(root, '  second  ');
    seq(esc(root.querySelector('textarea')!), esc(document));
    expect(look(r)).toBe(`idle|true|${PIN}|2|2|0`);
    ball(root).click();
    expect([rows(root), root.querySelector(`.${CLASS.dot}`)]).toEqual([['first', 'second'], dot]);
    ball(root).click();
    expect([look(r), r.onSubmit.mock.calls.length]).toEqual([`idle|true|${PIN}|2|2|0`, 0]);
  });

  it('R1 preserves a full-list draft across dismissal and reopening', () => {
    const drawing = { toggle: vi.fn(), cancel: vi.fn() };
    const r = setup(vi.fn(), { drawing });
    const { root } = r;
    r.overlay.arm();
    for (let i = 0; i < 20; i += 1) seq(compose(root, `c${i}`), keep(root));
    const input = compose(root, 'overflow');
    seq(r.overlay.setDrawing(true), ball(root).click(), esc(document));
    expect(look(r)).toBe(`composing|true|${PIN}|20|21|1`);
    expect([drawing.toggle.mock.lastCall, drawing.cancel.mock.calls.length]).toEqual([[false], 0]);
    pressHotkey();
    r.overlay.status({ markId: 'none', state: 'done', message: undefined, prUrl: undefined });
    expect(look(r)).toBe(`composing|false|${CLOSE}|20|21|1`);
    expect(root.querySelector('textarea')).toBe(input);
    expect(st(input.value, rows(root).length)).toBe('overflow|20');
    expect(root.textContent).toContain(KEPT_FULL_NOTE);
    esc(root);
    expect([count(root), r.onSubmit.mock.calls.length]).toEqual(['20', 0]);
  });

  it('R1 dismisses pending and failed sends without losing their outcomes', () => {
    const r = setup();
    const { root, overlay } = r;
    overlay.arm();
    seq(send(compose(root, 'hi')), esc(document));
    expect(look(r)).toBe(`sending|true|${PIN}|1|1|1`);
    overlay.acked('m1', false);
    expect(look(r)).toBe(`idle|true|${PIN}|1|1|1`);
    ball(root).click();
    seq(send(compose(root, 'again')), esc(root), overlay.failed('boom'));
    expect(look(r)).toBe(`sending|true|${PIN}|2|2|2`);
    ball(root).click();
    expect(look(r)).toBe(`sending|false|${PIN}|2|2|2`);
    expect(root.textContent).toContain('boom');
    seq(root.querySelector<HTMLElement>(`.${CLASS.send}`)!.click(), overlay.acked('m2', false));
    expect(r.onSubmit.mock.calls.map((c) => c[0].comment)).toEqual(['hi', 'again', 'again']);
    expect(st(overlay.phase(), count(root))).toBe('idle|2');
  });

  it('R1 disposes dismissal listeners and ignores late events', () => {
    const methods = ['addEventListener', 'removeEventListener'] as const;
    const spies = methods.map((m) => vi.spyOn(document, m));
    const { host, root, overlay, onSubmit } = setup();
    overlay.arm();
    seq(send(compose(root, 'late')), overlay.destroy());
    const [added, removed] = spies.map((s) => s.mock.calls.filter((c) => c[0] === 'keydown'));
    expect(added!.length).toBeGreaterThan(0);
    for (const call of added!) expect(removed).toContainEqual(call);
    seq(esc(document), esc(root), overlay.acked('m1', false), overlay.failed('x'), overlay.arm());
    const launchers = n(root, `.${CLASS.launcher}`);
    expect(st(overlay.phase(), onSubmit.mock.calls.length, launchers)).toBe('idle|1|0');
    expect(host.hasAttribute('data-pb-panel')).toBe(false);
  });

  it('retains marks and updates the badge while the panel is closed', () => {
    const { host, root, overlay } = setup();
    overlay.arm();
    send(compose(root, 'first'));
    overlay.acked('inbox-1', false);
    expect(ball(root).querySelector(`.${CLASS.count}`)!.textContent).toBe('1');

    esc(document);
    expect(closed(host)).toBe(true);

    overlay.status({ markId: 'inbox-1', state: 'done', message: undefined, prUrl: undefined });
    expect(root.querySelectorAll(`.${CLASS.dot}`).length).toBe(1);
    expect(root.querySelectorAll(`.${CLASS.bubble}`).length).toBe(1);
    expect(ball(root).querySelector(`.${CLASS.count}`)!.hasAttribute('hidden')).toBe(true);

    ball(root).click();
    const dot = root.querySelector(`.${CLASS.dot}`)!;
    expect(dot.getAttribute('data-state')).toBe('done');
    expect(overlay.openMarks()).toEqual([]);
  });

  it('destroys panel resources and starts a new overlay closed', () => {
    const { host, root, overlay } = setup(vi.fn(), {
      drawing: { toggle: vi.fn(), cancel: vi.fn() },
    });
    ball(root).click();
    seq(compose(root, 'one'), keep(root));
    expect(root.querySelector(`.${TRAY_CLASS.tray}`)).not.toBeNull();

    overlay.destroy();
    expect(root.querySelector(`.${TRAY_CLASS.tray}`)).toBeNull();
    expect(root.querySelector('style[data-pb-panel-styles]')).toBeNull();
    expect(host.hasAttribute('data-pb-panel')).toBe(false);

    const next = setup();
    expect(closed(next.host)).toBe(true);
  });

  it('R3 kept comments survive Escape with a count on the ball', () => {
    const r = setup();
    r.overlay.arm();
    seq(compose(r.root, 'one'), keep(r.root), compose(r.root, 'two'), keep(r.root));
    esc(document);
    expect(closed(r.host)).toBe(true);
    expect(count(r.root)).toBe('2');
    expect(n(r.root, `.${CLASS.bubble}`)).toBe('0');
    expect(r.onSubmit).not.toHaveBeenCalled();
    ball(r.root).click();
    expect(closed(r.host)).toBe(false);
    expect([...r.root.querySelectorAll(`.${CLASS.dot}`)].map((d) => d.textContent)).toEqual([
      '1',
      '2',
    ]);
  });

  it('R6 keeps the collapsed list across Escape and reopening', () => {
    const r = setup();
    r.overlay.arm();
    seq(compose(r.root, 'one'), keep(r.root), compose(r.root, 'two'), keep(r.root));
    const pill = () => r.root.querySelector<HTMLButtonElement>('.pb-toggle')!;
    const tray = () => r.root.querySelector(`.${TRAY_CLASS.tray}`)!;
    esc(document);
    ball(r.root).click();
    expect(pill().textContent).toBe('2 to send');
    pill().click();
    expect(tray().hasAttribute('data-collapsed')).toBe(true);
    esc(document);
    expect(closed(r.host)).toBe(true);
    ball(r.root).click();
    expect(closed(r.host)).toBe(false);
    expect([tray().hasAttribute('data-collapsed'), pill().textContent]).toEqual([
      true,
      '2 to send',
    ]);
    pill().click();
    expect(tray().hasAttribute('data-collapsed')).toBe(false);
  });

  it('R6 the Send all button asks the collector chunk to send the kept comments', () => {
    const r = setup();
    const heard = vi.fn();
    r.host.addEventListener('passback:send-all', heard);
    r.overlay.arm();
    seq(compose(r.root, 'one'), keep(r.root));
    r.root.querySelector<HTMLElement>(`.${TRAY_CLASS.tray} .${CLASS.send}`)!.click();
    expect(heard).toHaveBeenCalledTimes(1);
    r.root.querySelector<HTMLElement>(`.${TRAY_CLASS.tray} .${CLASS.send}`)!.click();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('R6 shows the list as soon as a comment is kept, without screenshots', () => {
    const r = setup();
    r.overlay.arm();
    seq(compose(r.root, 'one'), keep(r.root));
    expect(r.root.querySelector(`.${TRAY_CLASS.tray}`)).not.toBeNull();
    expect(rows(r.root)).toContain('one');
  });
});
