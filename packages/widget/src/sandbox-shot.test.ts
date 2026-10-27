// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSandboxShot, sandboxShot } from './sandbox-shot';
import { createShotStep } from './shot-step';
import type { ShotOpen, ShotOpenOptions, ShotOutcome } from './shot-loader';

function fakeOpen(count = 0) {
  const session = {
    setActive: vi.fn<(on: boolean) => void>(),
    count: vi.fn<() => number>(() => count),
    finish: vi.fn<(el: Element) => Promise<ShotOutcome>>(async () => ({
      note: 'real finish',
    })),
    close: vi.fn<() => void>(),
  };
  const open = vi.fn<ShotOpen>(() => session);
  return { open, session };
}

function options(): ShotOpenOptions {
  const host = document.createElement('div');
  return { win: window, root: host.attachShadow({ mode: 'open' }), host, uploadUrl: 'x' };
}

function register(shot: unknown): void {
  (window as unknown as { __passback?: unknown }).__passback = { shot };
}

function makeStep() {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  return createShotStep({
    doc: document,
    win: window as Window & typeof globalThis,
    root,
    host,
    onLoadFailed: vi.fn(),
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

afterEach(() => {
  delete (window as unknown as { __passback?: unknown }).__passback;
  document.head.innerHTML = '';
});

describe('sandboxShot', () => {
  it('passes setActive, count and close through to the real session', () => {
    const { open, session } = fakeOpen(3);
    const opts = options();
    const wrapped = sandboxShot(open)(opts);
    wrapped.setActive(true);
    expect(wrapped.count()).toBe(3);
    wrapped.close();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(opts);
    expect(session.setActive).toHaveBeenCalledWith(true);
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('resolves finish with an empty outcome and never calls the real finish', async () => {
    const { open, session } = fakeOpen(2);
    const wrapped = sandboxShot(open)(options());
    await expect(wrapped.finish(document.body)).resolves.toEqual({});
    expect(session.finish).not.toHaveBeenCalled();
  });

  it('marks the wrapped function as a sandbox shot and nothing else as one', () => {
    const { open } = fakeOpen();
    expect(sandboxShot(open).sandbox).toBe(true);
    expect(isSandboxShot(sandboxShot(open))).toBe(true);
    expect(isSandboxShot(open)).toBe(false);
    expect(isSandboxShot(Object.assign(() => 0, { sandbox: 'true' }))).toBe(false);
    expect(isSandboxShot({ sandbox: true })).toBe(false);
    expect(isSandboxShot(undefined)).toBe(false);
  });
});

describe('shot step with a sandbox shot', () => {
  it('turns the step on when a sandbox shot is registered and no script tag opted in', async () => {
    const { open } = fakeOpen();
    register(sandboxShot(open));
    const step = makeStep();
    expect(step.enabled).toBe(true);
    step.toggle(true);
    await settle();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0].uploadUrl).toBe('');
  });

  it('keeps the step off when an ordinary shot function is registered and no script tag opted in', async () => {
    const { open } = fakeOpen();
    register(open);
    const step = makeStep();
    expect(step.enabled).toBe(false);
    step.toggle(true);
    await settle();
    expect(open).not.toHaveBeenCalled();
  });

  it('finishes a sandbox session with something drawn without calling the real finish', async () => {
    const { open, session } = fakeOpen(2);
    register(sandboxShot(open));
    const step = makeStep();
    step.toggle(true);
    await settle();
    await expect(step.finish(document.body)).resolves.toEqual({});
    expect(session.finish).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(1);
  });
});
