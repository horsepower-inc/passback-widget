// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolveTarget } from '@passback/collectors';
import type { Collector, CollectOptions } from './collect';
import { HOST_ATTRIBUTE } from './mount';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import type { Widget } from './index';

const FAKE_TARGET = { selectors: [], tag: 'div', text: '' } as ResolveTarget;
let widgets: Widget[] = [];

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  widgets = [];
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete (window as unknown as { __passback?: unknown }).__passback;
});

async function fixedWith(caps: unknown): Promise<ShadowRoot> {
  let options: CollectOptions | undefined;
  const collector = {
    relay: false,
    send: vi.fn(async () => ({ ok: true, id: 'abc', trimmed: false })),
    selectorOf: () => '#save',
    targetOf: () => FAKE_TARGET,
    reresolve: () => null,
    dispose: () => {},
  } as unknown as Collector;
  (window as unknown as { __passback?: unknown }).__passback = {
    autoStart: false,
    caps,
    hot: { send: vi.fn(), on: vi.fn(), off: vi.fn() },
    collect: (opts: CollectOptions) => ((options = opts), collector),
  };
  const { start } = await import('./index');
  const widget = start();
  widgets.push(widget);
  const root = document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`)!.shadowRoot!;
  armWidget(root);
  const target = document.body.appendChild(document.createElement('div'));
  target.id = 'save';
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
  );
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = 'wrong';
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  for (let i = 0; i < 10; i++) await Promise.resolve();
  options!.onStatus?.({ markId: 'abc', state: 'done' } as never);
  return root;
}

describe('widget reopen wiring', () => {
  it('offers Still wrong? on a fixed mark when the bridge lists reopen', async () => {
    const root = await fixedWith(['reopen']);
    expect(root.querySelector('button[data-role="reopen"]')).not.toBeNull();
  });

  it('offers nothing when the bridge lists no capability', async () => {
    const root = await fixedWith([]);
    expect(root.querySelector('button[data-role="reopen"]')).toBeNull();
  });
});
