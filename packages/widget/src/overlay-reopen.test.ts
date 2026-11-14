// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Overlay } from './overlay';
import { createOverlay } from './overlay';
import type { ReopenPort } from './reopen';
import { CLASS } from './styles';

let overlays: Overlay[] = [];

afterEach(() => {
  overlays.forEach((overlay) => overlay.destroy());
  overlays = [];
  document.body.innerHTML = '';
});

function setup(reopen?: ReopenPort) {
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const overlay = createOverlay({
    doc: document,
    root,
    host,
    selectorOf: (el) => el.tagName.toLowerCase(),
    onSubmit: vi.fn(),
    reopen,
  });
  overlays.push(overlay);
  return { host, root, overlay };
}

function fixed(r: ReturnType<typeof setup>, id = 'm1'): void {
  r.overlay.arm();
  const target = document.body.appendChild(document.createElement('div'));
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
  );
  const input = r.root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = 'wrong';
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  r.overlay.acked(id, false);
  r.overlay.status({ markId: id, state: 'done' });
}

const still = (root: ShadowRoot) =>
  root.querySelector<HTMLButtonElement>('button[data-role="reopen"]');
const box = (root: ShadowRoot) =>
  root.querySelector<HTMLTextAreaElement>(`.${CLASS.bubble} textarea`)!;

function type(root: ShadowRoot, text: string, key = 'Enter'): void {
  const area = box(root);
  area.value = text;
  area.dispatchEvent(new Event('input'));
  area.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true }),
  );
}

const port = (result = true) => ({ send: vi.fn(async () => result) });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('offerReopen', () => {
  it('offers Still wrong? on a fixed mark when a reopen port exists', () => {
    const r = setup(port());
    fixed(r);
    expect(still(r.root)?.textContent).toBe('Still wrong?');
  });

  it('offers nothing on a fixed mark without a reopen port', () => {
    const r = setup();
    fixed(r);
    expect(still(r.root)).toBeNull();
  });

  it('opens the reopen box on click and Escape brings back the Fixed note', () => {
    const r = setup(port());
    fixed(r);
    still(r.root)!.click();
    expect(r.root.querySelector(`.${CLASS.bubble}`)!.textContent).toContain('What is still wrong?');
    type(r.root, '', 'Escape');
    expect(r.root.querySelector(`.${CLASS.bubble}`)!.textContent).not.toContain(
      'What is still wrong?',
    );
    expect(still(r.root)).not.toBeNull();
  });

  it('Escape in the reopen box leaves an open panel open, so the Fixed note stays visible', () => {
    const r = setup(port());
    fixed(r);
    expect(r.host.getAttribute('data-pb-panel')).toBe('open');
    still(r.root)!.click();
    type(r.root, '', 'Escape');
    expect(r.host.getAttribute('data-pb-panel')).toBe('open');
    expect(still(r.root)).not.toBeNull();
  });

  it('sends the typed comment through the port with the mark id', () => {
    const p = port();
    const r = setup(p);
    fixed(r);
    still(r.root)!.click();
    type(r.root, 'still off');
    expect(p.send).toHaveBeenCalledWith('m1', 'still off');
  });

  it('a queued status after the send puts the dot back to Waiting', async () => {
    const r = setup(port());
    fixed(r);
    still(r.root)!.click();
    type(r.root, 'still off');
    await flush();
    r.overlay.status({ markId: 'm1', state: 'queued' });
    expect(r.root.querySelector(`.${CLASS.dot}`)!.getAttribute('data-state')).toBe('queued');
    expect(r.root.querySelector(`.${CLASS.bubble}`)!.textContent).toContain(
      'Waiting for the agent',
    );
  });

  it('failure: a reopen the port reports as not applied shows Not sent, keeps the comment and Retry sends it again', async () => {
    const p = port(false);
    const r = setup(p);
    fixed(r);
    still(r.root)!.click();
    type(r.root, 'still off');
    await flush();
    const text = r.root.querySelector(`.${CLASS.bubble}`)!.textContent!;
    expect(text).toContain('Not sent: the dev server did not confirm it.');
    expect(text).toContain('Your comment is kept.');
    const retry = [...r.root.querySelectorAll<HTMLButtonElement>(`.${CLASS.bubble} button`)].find(
      (b) => b.textContent === 'Retry',
    )!;
    retry.click();
    expect(p.send).toHaveBeenCalledTimes(2);
    expect(p.send).toHaveBeenLastCalledWith('m1', 'still off');
  });

  it('destroying the overlay with the reopen box open removes its Escape listener', async () => {
    const r = setup(port());
    fixed(r);
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    still(r.root)!.click();
    const listener = added.mock.calls.find(([type]) => type === 'keydown')![1];
    r.overlay.destroy();
    overlays = [];
    await flush();
    expect(removed).toHaveBeenCalledWith('keydown', listener, true);
    added.mockRestore();
    removed.mockRestore();
  });

  it('a click on the fixed dot opens its bubble while the panel rests', () => {
    const r = setup(port());
    fixed(r);
    r.host.setAttribute('data-pb-panel', 'rest');
    const bubble = r.root.querySelector<HTMLElement>(`.${CLASS.bubble}`)!;
    expect(bubble.hasAttribute('data-pb-open')).toBe(false);
    r.root.querySelector<HTMLElement>(`.${CLASS.dot}`)!.click();
    expect(bubble.hasAttribute('data-pb-open')).toBe(true);
    expect(r.root.querySelector('style[data-pb-reopen-styles]')?.textContent).toContain(
      "[data-pb-panel='rest']",
    );
  });
});
