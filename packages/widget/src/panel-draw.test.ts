// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';
import { sandboxShot } from './sandbox-shot';
import type { ShotOpen } from './shot-loader';
import { createShotStep, drawingOf } from './shot-step';
import { CLASS } from './styles';

const gate: { reject: ((reason: Error) => void) | null } = { reject: null };
vi.mock('./shot-loader', async (importOriginal) => {
  const real = await importOriginal<typeof import('./shot-loader')>();
  return {
    ...real,
    loadShotOpen: (...args: Parameters<typeof real.loadShotOpen>) =>
      gate.reject === null
        ? real.loadShotOpen(...args)
        : new Promise<never>((_, reject) => {
            gate.reject = reject;
          }),
  };
});

type Win = Window & typeof globalThis;
let overlays: Overlay[] = [];
afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  gate.reject = null;
  sessions = [];
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete (window as unknown as { __passback?: unknown }).__passback;
});

const fakeSession = () => ({
  setActive: vi.fn(),
  count: vi.fn(() => 1),
  finish: vi.fn(async () => ({})),
  close: vi.fn(),
});
let sessions: ReturnType<typeof fakeSession>[] = [];

function enable(kind: 'script' | 'sandbox' | 'none'): void {
  if (kind === 'script') {
    const script = document.createElement('script');
    script.setAttribute('data-passback-screenshots', 'true');
    script.setAttribute('data-passback-shot', 'https://cdn.test/shot.js');
    script.setAttribute('data-passback-endpoint', 'https://relay.test');
    document.head.append(script);
  }
  if (kind === 'sandbox') {
    const open: ShotOpen = () => {
      const session = fakeSession();
      sessions.push(session);
      return session;
    };
    (window as unknown as { __passback: unknown }).__passback = { shot: sandboxShot(open) };
  }
}

function setup(kind: 'script' | 'sandbox' | 'none' = 'sandbox') {
  enable(kind);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const holder: { overlay?: Overlay } = {};
  const step = createShotStep({
    doc: document,
    win: window as Win,
    root,
    host,
    onLoadFailed: () => holder.overlay?.setDrawing(false),
  });
  const toggle = vi.spyOn(step, 'toggle');
  const close = vi.spyOn(step, 'close');
  const onSubmit = vi.fn();
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: () => 'div',
    onSubmit,
    ...drawingOf(step),
  });
  holder.overlay = overlay;
  overlays.push(overlay);
  return { host, root, overlay, step, toggle, close, onSubmit };
}

type Ctx = ReturnType<typeof setup>;
const pencil = ({ root }: Ctx) => root.querySelector<HTMLButtonElement>('[data-role="draw"]');
const pressed = (b: HTMLElement | null) => b?.getAttribute('aria-pressed');

function compose(c: Ctx): HTMLTextAreaElement {
  c.overlay.arm();
  const target = document.createElement('div');
  document.body.appendChild(target);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  return c.root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
}

function enter(input: HTMLTextAreaElement, text = 'a comment'): void {
  input.value = text;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('drawing from the bubble pencil', () => {
  it('toggles drawing once per click and keeps the pencil in step', () => {
    const c = setup();
    compose(c);
    expect(pressed(pencil(c))).toBe('false');
    pencil(c)!.click();
    expect(c.toggle.mock.calls).toEqual([[true]]);
    expect(pressed(pencil(c))).toBe('true');
    pencil(c)!.click();
    expect(c.toggle.mock.calls).toEqual([[true], [false]]);
    expect(pressed(pencil(c))).toBe('false');
  });

  it('resets the pencil after shot load failure without another toggle', async () => {
    const c = setup('script');
    compose(c);
    gate.reject = () => undefined;
    pencil(c)!.click();
    expect(pressed(pencil(c))).toBe('true');
    gate.reject!(new Error('chunk failed'));
    await flush();
    expect(pressed(pencil(c))).toBe('false');
    expect(c.toggle).toHaveBeenCalledTimes(1);
    pencil(c)!.click();
    expect(c.toggle).toHaveBeenCalledTimes(2);
    expect(c.toggle).toHaveBeenLastCalledWith(true);
    expect(pressed(pencil(c))).toBe('true');
    gate.reject = null;
  });

  it('preserves cancel, send and destroy effects with drawing active', async () => {
    const cancelled = setup();
    const input = compose(cancelled);
    pencil(cancelled)!.click();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancelled.close).not.toHaveBeenCalled();

    const drawn = setup();
    const text = compose(drawn);
    pencil(drawn)!.click();
    await flush();
    const [session] = sessions;
    expect(session!.setActive).not.toHaveBeenCalled();
    enter(text);
    expect(drawn.onSubmit).toHaveBeenCalledTimes(1);
    expect(drawn.toggle.mock.calls).toEqual([[true], [false]]);
    expect(session!.setActive.mock.calls).toEqual([[false]]);
    expect(drawn.close).not.toHaveBeenCalled();
    expect(session!.close).not.toHaveBeenCalled();
    // The session survived the send, so the screenshot step can still finish it.
    await drawn.step.finish(document.body);
    expect(session!.count).not.toHaveBeenCalled();
    expect(session!.close).toHaveBeenCalledTimes(1);

    const torn = setup();
    compose(torn);
    pencil(torn)!.click();
    await flush();
    torn.overlay.destroy();
    torn.overlay.destroy();
    expect(torn.close).toHaveBeenCalledTimes(1);
    expect(sessions[1]!.close).toHaveBeenCalledTimes(1);
    torn.overlay.setDrawing(false);
    expect(torn.toggle.mock.calls).toEqual([[true]]);
  });
});
