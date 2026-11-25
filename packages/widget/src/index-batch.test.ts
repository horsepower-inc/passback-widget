// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolveTarget } from '@passback/collectors';
import type { BatchItem, Collector } from './collect';
import type { BatchSendResult } from './send';
import { sendAll } from './send-all';
import { HOST_ATTRIBUTE } from './mount';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import { TRAY_CLASS } from './tray-view';
import type { Widget } from './index';

const scope = globalThis as { __passback?: unknown };
const TARGET = { selectors: [], tag: 'div', text: '' } as ResolveTarget;
let widgets: Widget[] = [];

function collectorOf(result: BatchSendResult) {
  const sendBatch = vi.fn<(items: readonly BatchItem[]) => Promise<BatchSendResult>>(
    async () => result,
  );
  const collector: Collector = {
    relay: true,
    send: vi.fn(),
    sendBatch,
    selectorOf: () => '#t',
    targetOf: () => TARGET,
    reresolve: () => null,
    dispose: vi.fn(),
  };
  return { collector, sendBatch };
}

async function startWidget(collector: Collector): Promise<ShadowRoot> {
  scope.__passback = { autoStart: false, collect: () => collector, fx: { addons: [sendAll] } };
  const { start } = await import('./index');
  widgets.push(start());
  return document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`)!.shadowRoot!;
}

function keep(root: ShadowRoot, text: string): Element {
  const target = document.body.appendChild(document.createElement('div'));
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }),
  );
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = text;
  input.dispatchEvent(new Event('input'));
  root.querySelector<HTMLElement>('[data-role="add-more"]')!.click();
  return target;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const dots = (root: ShadowRoot) =>
  [...root.querySelectorAll(`.${CLASS.dot}`)].map((dot) => dot.getAttribute('data-state'));

async function sendAllOf(collector: Collector): Promise<{ root: ShadowRoot; targets: Element[] }> {
  const root = await startWidget(collector);
  armWidget(root);
  await settle();
  const targets = [keep(root, 'one'), keep(root, 'two')];
  root.querySelector<HTMLElement>(`.${TRAY_CLASS.tray} .${CLASS.send}`)!.click();
  await settle();
  return { root, targets };
}

beforeEach(() => vi.resetModules());

afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  widgets = [];
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete scope.__passback;
});

describe('widget Send all wiring', () => {
  it('a Send all of kept comments hands one batch with one picture outcome per comment to the collector', async () => {
    const { collector, sendBatch } = collectorOf({
      ok: true,
      ids: ['t1', 't1'],
      trimmed: [false, false],
    });
    const { root, targets } = await sendAllOf(collector);
    expect(sendBatch).toHaveBeenCalledOnce();
    expect(sendBatch.mock.calls[0]![0]).toEqual([
      { el: targets[0], comment: 'one' },
      { el: targets[1], comment: 'two' },
    ]);
    expect(collector.send).not.toHaveBeenCalled();
    expect(dots(root)).toEqual(['sent', 'sent']);
    expect(root.querySelectorAll('.pb-list li')).toHaveLength(0);
  });

  it('a Send all whose batch fails keeps every comment and shows the error once', async () => {
    const { collector, sendBatch } = collectorOf({ ok: false, reason: 'network', message: 'down' });
    const { root } = await sendAllOf(collector);
    expect(sendBatch).toHaveBeenCalledOnce();
    expect(dots(root)).toEqual(['failed', 'failed']);
    expect(root.querySelectorAll('.pb-list li')).toHaveLength(2);
    expect(root.textContent!.match(/down/g)).toHaveLength(1);
  });
});
