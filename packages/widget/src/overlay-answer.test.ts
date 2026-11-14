// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';
import { CLASS } from './styles';

let overlays: Overlay[] = [];

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  document.body.innerHTML = '';
});

const QUESTION = 'Which locale should the date use?';

function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn(),
  });
  overlays.push(overlay);
  overlay.arm();
  const target = document.body.appendChild(document.createElement('div'));
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
  );
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = 'wrong';
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  overlay.acked('m1', false);
  return { host, root, overlay };
}

function ask(root: ShadowRoot, overlay: Overlay) {
  overlay.status({ markId: 'm1', state: 'question', message: QUESTION });
  return root.querySelector<HTMLElement>(`.${CLASS.bubble}`)!;
}

/** The overlay finds the port on the window bridge, like the widget does. */
function bridge(sent: Array<[string, unknown]>, taken: boolean) {
  const listeners: Array<(data: unknown) => void> = [];
  (globalThis as { __passback?: unknown }).__passback = {
    caps: ['answer'],
    hot: {
      send: (event: string, data: unknown) => {
        sent.push([event, data]);
        if (taken) listeners.forEach((cb) => cb({ markId: 'm1', state: 'running' }));
      },
      on: (_event: string, cb: (data: unknown) => void) => listeners.push(cb),
      off: () => {},
    },
  };
}

afterEach(() => {
  delete (globalThis as { __passback?: unknown }).__passback;
  vi.useRealTimers();
});

const textarea = (root: ShadowRoot) =>
  root.querySelector<HTMLTextAreaElement>(`.${CLASS.bubble} textarea`);

function answerWith(root: ShadowRoot, text: string): void {
  const area = textarea(root)!;
  area.value = text;
  area.dispatchEvent(new Event('input'));
  area.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }),
  );
}

describe('offerAnswer', () => {
  it('opens an answer card with the question on a question status', () => {
    bridge([], true);
    const r = setup();
    const bubble = ask(r.root, r.overlay);
    expect(bubble.hasAttribute('data-pb-open')).toBe(true);
    expect(bubble.textContent).toContain('The agent has a question');
    expect(bubble.textContent).toContain(QUESTION);
    expect(textarea(r.root)).not.toBeNull();
  });

  it('sends the typed answer through the port and keeps the card until running arrives', () => {
    const sent: Array<[string, unknown]> = [];
    bridge(sent, false);
    const r = setup();
    const bubble = ask(r.root, r.overlay);
    answerWith(r.root, 'en-GB');
    expect(sent).toEqual([['passback:answer', { v: 1, markId: 'm1', text: 'en-GB' }]]);
    expect(bubble.textContent).toContain(QUESTION);
    expect(textarea(r.root)).not.toBeNull();
  });

  it('shows the retry error when the port resolves false and sends the same text again', async () => {
    vi.useFakeTimers();
    const sent: Array<[string, unknown]> = [];
    bridge(sent, false);
    const r = setup();
    const bubble = ask(r.root, r.overlay);
    const synced = vi.fn();
    r.host.addEventListener('passback:sync', synced);
    answerWith(r.root, 'en-GB');
    await vi.advanceTimersByTimeAsync(5000);
    expect(bubble.textContent).toContain('the dev server did not confirm it.');
    expect(synced).toHaveBeenCalled();
    bubble.querySelector<HTMLButtonElement>('button')!.click();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });

  it('leaves the bubble with the question text and no box without an answer port', () => {
    const r = setup();
    const bubble = ask(r.root, r.overlay);
    expect(bubble.textContent).toContain(QUESTION);
    expect(textarea(r.root)).toBeNull();
  });

  it('puts the card back to the status text when a running status follows', () => {
    bridge([], false);
    const r = setup();
    const bubble = ask(r.root, r.overlay);
    expect(textarea(r.root)).not.toBeNull();
    r.overlay.status({ markId: 'm1', state: 'running' });
    expect(textarea(r.root)).toBeNull();
    expect(bubble.textContent).not.toContain('The agent has a question');
  });
});
