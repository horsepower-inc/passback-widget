// @vitest-environment happy-dom
import type { ResolveTarget } from '@passback/collectors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bubble } from './bubble-view';
import type { Dot, DotState } from './dot-view';
import { createOverlay } from './overlay';
import type { OpenOverlayMark, TrackedMark } from './overlay-reattach';
import { applyReattach } from './overlay-reattach';
import type { Reattached } from './reattach';
import { CLASS } from './styles';
import { armWidget } from './test-arm';

const TARGET = { tag: 'button' } as unknown as ResolveTarget;

function stubDot(state: DotState = 'pinned') {
  const element = document.createElement('div');
  element.setAttribute('data-state', state);
  const dot = {
    element,
    setState: vi.fn((next: DotState) => element.setAttribute('data-state', next)),
    moveTo: vi.fn(),
    remove: vi.fn(),
  };
  return dot as typeof dot & Dot;
}

function stubBubble() {
  const bubble = { moveTo: vi.fn(), showNote: vi.fn(), destroy: vi.fn() };
  return bubble as unknown as typeof bubble & Bubble;
}

function mark(id: string, over: Partial<TrackedMark> = {}) {
  return {
    id,
    dot: stubDot(),
    bubble: stubBubble(),
    lastState: 'queued',
    target: TARGET,
    ...over,
  } as TrackedMark & {
    dot: ReturnType<typeof stubDot>;
    bubble: ReturnType<typeof stubBubble>;
  };
}

function elementAt(left: number, top: number): Element {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left, top }) as DOMRect;
  return el;
}

function found(id: string, element: Element): Reattached<OpenOverlayMark> {
  return { mark: { id, target: TARGET }, element, orphaned: false };
}

function lost(id: string): Reattached<OpenOverlayMark> {
  return { mark: { id, target: TARGET }, element: null, orphaned: true };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('overlay reattach', () => {
  it('openMarks lists only acked marks that have a target', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const target = { tag: 'div' } as unknown as ResolveTarget;
    const overlay = createOverlay({
      doc: document,
      root,
      host,
      selectorOf: () => 'div',
      targetOf: () => target,
      onSubmit: vi.fn(),
    });
    const place = (): void => {
      armWidget(root);
      const el = document.createElement('div');
      document.body.appendChild(el);
      el.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: 1,
          clientY: 1,
        }),
      );
      const inputs = root.querySelectorAll<HTMLTextAreaElement>(`.${CLASS.input}`);
      const input = inputs[inputs.length - 1]!;
      input.value = 'c';
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    };
    place();
    overlay.acked('m1', false);
    place();
    expect(overlay.openMarks()).toEqual([{ id: 'm1', target }]);
    overlay.destroy();
  });

  it('a found mark moves its dot and bubble to the element rect plus the pinned offset', () => {
    const m = mark('a', { offset: { x: 5, y: 7 } });
    applyReattach([m], [found('a', elementAt(100, 200))], { kind: 'restored' });
    expect(m.dot.moveTo).toHaveBeenCalledWith({ x: 105, y: 207 });
    expect(m.bubble.moveTo).toHaveBeenCalledWith({ x: 105, y: 207 });
  });

  it('an orphaned mark shows the orphaned state and note', () => {
    const m = mark('a');
    applyReattach([m], [lost('a')], { kind: 'restored' });
    expect(m.dot.setState).toHaveBeenCalledWith('orphaned');
    expect(m.bubble.showNote).toHaveBeenCalledWith('Orphaned: the marked element is gone');
  });

  it('a mark found again after being orphaned gets its last status back', () => {
    const m = mark('a', { lastState: 'running' });
    applyReattach([m], [lost('a')], { kind: 'restored' });
    applyReattach([m], [found('a', elementAt(1, 2))], { kind: 'restored' });
    expect(m.dot.setState).toHaveBeenLastCalledWith('running');
  });

  it('a reset view puts the state reset message in each found mark bubble', () => {
    const a = mark('a');
    const b = mark('b');
    const view = {
      kind: 'reset',
      route: '/x',
      message: 'state reset — re-navigate to /x',
    } as const;
    applyReattach([a, b], [found('a', elementAt(0, 0)), lost('b')], view);
    expect(a.bubble.showNote).toHaveBeenCalledWith(view.message);
    expect(b.bubble.showNote).not.toHaveBeenCalledWith(view.message);
  });

  it('an unknown result id is ignored', () => {
    const m = mark('a');
    applyReattach([m], [found('zzz', elementAt(0, 0)), lost('nope')], { kind: 'restored' });
    expect(m.dot.moveTo).not.toHaveBeenCalled();
    expect(m.dot.setState).not.toHaveBeenCalled();
    expect(m.bubble.showNote).not.toHaveBeenCalled();
  });
});
