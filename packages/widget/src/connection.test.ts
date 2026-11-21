// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connection } from './connection';

type Handler = () => void;

function setup(withHot = true) {
  const on = vi.fn();
  const off = vi.fn();
  (window as unknown as { __passback?: unknown }).__passback = withHot
    ? { hot: { on, off, send: vi.fn() } }
    : {};
  const host = document.createElement('div');
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const ball = document.createElement('button');
  ball.className = 'pb-launcher';
  ball.setAttribute('aria-label', 'Passback: open');
  const bubble = document.createElement('div');
  bubble.className = 'pb-bubble';
  const send = document.createElement('button');
  send.setAttribute('data-role', 'send');
  const comment = document.createElement('textarea');
  comment.value = 'unsent text';
  bubble.append(comment, send);
  const tray = document.createElement('div');
  tray.className = 'pb-tray';
  const sendAll = document.createElement('button');
  sendAll.className = 'pb-send';
  tray.append(sendAll);
  root.append(ball, bubble, tray);
  connection({ root, host, launcher: { element: ball } } as never);
  const fire = (event: string): void => {
    for (const call of on.mock.calls) if (call[0] === event) (call[1] as Handler)();
  };
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  return { host, root, ball, bubble, send, sendAll, comment, on, off, fire, tick };
}

afterEach(() => {
  document.body.replaceChildren();
  delete (window as unknown as { __passback?: unknown }).__passback;
});

describe('connection add-on', () => {
  it('marks the host offline, labels the ball and disables Send when the dev server disconnects', () => {
    const t = setup();
    t.fire('vite:ws:disconnect');
    expect(t.host.getAttribute('data-pb-connection')).toBe('offline');
    expect(t.ball.querySelector('[part="offline-badge"]')).not.toBeNull();
    expect(t.ball.getAttribute('aria-label')).toBe('Passback: dev server offline');
    expect(t.send.disabled).toBe(true);
    expect(t.sendAll.disabled).toBe(true);
  });

  it('clears the offline state and enables Send again when the dev server reconnects', () => {
    const t = setup();
    t.fire('vite:ws:disconnect');
    t.fire('vite:ws:connect');
    expect(t.host.hasAttribute('data-pb-connection')).toBe(false);
    expect(t.ball.querySelector('[part="offline-badge"]')).toBeNull();
    expect(t.ball.getAttribute('aria-label')).toBe('Passback: open');
    expect(t.send.disabled).toBe(false);
    expect(t.sendAll.disabled).toBe(false);
    expect(t.root.querySelector('[data-pb-offline-line]')).toBeNull();
  });

  it('shows the offline line and keeps the unsent comment', () => {
    const t = setup();
    t.fire('vite:ws:disconnect');
    const line = t.bubble.querySelector('[data-role="hint"]');
    expect(line?.textContent).toBe('Dev server offline: reconnect to send');
    expect(t.comment.value).toBe('unsent text');
  });

  it('keeps the offline label when the panel rewrites the ball label', async () => {
    const t = setup();
    t.fire('vite:ws:disconnect');
    t.ball.setAttribute('aria-label', 'Passback: close');
    await t.tick();
    expect(t.ball.getAttribute('aria-label')).toBe('Passback: dev server offline');
    t.fire('vite:ws:connect');
    expect(t.ball.getAttribute('aria-label')).toBe('Passback: close');
  });

  it('keeps Send disabled while offline when the comment is edited', () => {
    const t = setup();
    t.send.disabled = false;
    t.comment.addEventListener('input', () => {
      t.send.disabled = t.comment.value.trim() === '';
    });
    t.fire('vite:ws:disconnect');
    t.comment.value = 'edited text';
    t.comment.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    expect(t.send.disabled).toBe(true);
    t.comment.value = '';
    t.comment.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    t.fire('vite:ws:connect');
    expect(t.send.disabled).toBe(true);
  });

  it('does not send on Enter while offline', () => {
    const t = setup();
    const sent = vi.fn();
    t.comment.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) sent();
    });
    const enter = (): KeyboardEvent =>
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        composed: true,
        cancelable: true,
      });
    t.fire('vite:ws:disconnect');
    const blocked = enter();
    t.comment.dispatchEvent(blocked);
    expect(sent).not.toHaveBeenCalled();
    expect(blocked.defaultPrevented).toBe(true);
    t.fire('vite:ws:connect');
    t.comment.dispatchEvent(enter());
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('lets Enter activate the bubble buttons while offline', () => {
    const t = setup();
    const discard = document.createElement('button');
    t.bubble.append(discard);
    t.fire('vite:ws:disconnect');
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    discard.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
  });

  it('never shows the offline state in relay mode', () => {
    const t = setup(false);
    expect(t.on).not.toHaveBeenCalled();
    expect(t.host.hasAttribute('data-pb-connection')).toBe(false);
    expect(t.ball.querySelector('[part="offline-badge"]')).toBeNull();
    expect(t.send.disabled).toBe(false);
  });
});
