// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolveTarget } from '@passback/collectors';
import type { Collector } from './collect';
import { HOST_ATTRIBUTE } from './mount';
import { createOverlay } from './overlay';
import type { SubmitCtx } from './overlay-submit';
import type { SendResult } from './send';
import { CLASS } from './styles';
import { armWidget } from './test-arm';
import type { Widget } from './index';

type Passback = { autoStart: boolean; collect?: unknown; hot?: unknown; fx?: unknown };

const TARGET = { selectors: [], tag: 'div', text: '' } as unknown as ResolveTarget;
const OK: SendResult = { ok: true, id: 'mark-1', trimmed: false };
const HOT = { send: vi.fn(), on: vi.fn(), off: vi.fn() };

const scope = window as unknown as { __passback?: Passback };
let widgets: Widget[] = [];
let ctx: SubmitCtx | undefined;

function fakeCollector(relay: boolean): Collector & { send: ReturnType<typeof vi.fn> } {
  return {
    relay,
    send: vi.fn(async () => OK),
    selectorOf: () => '#save',
    targetOf: () => TARGET,
    reresolve: () => null,
    dispose: vi.fn(),
  };
}

function script(attrs: Record<string, string>): void {
  const el = document.createElement('script');
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  document.head.appendChild(el);
}

async function startWidget(passback: Omit<Passback, 'autoStart' | 'fx'>): Promise<ShadowRoot> {
  scope.__passback = {
    autoStart: false,
    ...passback,
    fx: { addons: [(c: SubmitCtx) => (ctx = c)] },
  };
  const { start } = await import('./index');
  widgets.push(start());
  return document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`)!.shadowRoot!;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function send(root: ShadowRoot): Element {
  armWidget(root);
  const target = document.body.appendChild(document.createElement('div'));
  target.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
  const click = { bubbles: true, cancelable: true, composed: true, clientX: 15, clientY: 27 };
  target.dispatchEvent(new MouseEvent('click', click));
  const input = root.querySelector<HTMLTextAreaElement>(`.${CLASS.input}`)!;
  input.value = 'hi';
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  return target;
}

const bubbleText = (root: ShadowRoot): string =>
  root.querySelector(`.${CLASS.bubble}`)?.textContent ?? '';
const dotState = (root: ShadowRoot): string | null =>
  root.querySelector(`.${CLASS.dot}`)!.getAttribute('data-state');

beforeEach(() => {
  vi.resetModules();
  ctx = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ relay: { tracker: 'x' } }), { status: 200 })),
  );
});

afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  widgets = [];
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete scope.__passback;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('overlay relay mode', () => {
  it('exposes relay mode before readiness resolves', async () => {
    for (const hot of [undefined, HOT]) {
      vi.resetModules();
      document.head.innerHTML = '';
      script({ 'data-passback-chunk': '/chunk.js' });
      const root = await startWidget({ hot });
      const loading: Node[] = [];
      vi.spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
        loading.push(node);
        return node;
      }) as typeof document.head.appendChild);
      expect(ctx?.relay?.()).toBe(hot === undefined);
      expect(loading).toHaveLength(0);
      send(root);
      await settle();
      expect(loading).toHaveLength(1);
      expect(dotState(root)).toBe('sending');
      expect(ctx?.relay?.()).toBe(hot === undefined);
      const collector = fakeCollector(hot === undefined);
      scope.__passback!.collect = () => collector;
      loading[0]!.dispatchEvent(new Event('load'));
      await settle();
      expect(collector.send).toHaveBeenCalledTimes(1);
      expect(ctx?.relay?.()).toBe(hot === undefined);
      vi.restoreAllMocks();
      widgets.forEach((widget) => widget.stop());
      widgets = [];
      document.body.innerHTML = '';
    }
  });

  it('uses effective hot rather than endpoint presence', async () => {
    for (const endpoint of [undefined, '/__passback/mark']) {
      for (const hot of [undefined, HOT]) {
        vi.resetModules();
        document.head.innerHTML = '';
        if (endpoint !== undefined) script({ 'data-passback-endpoint': endpoint });
        await startWidget({ hot });
        expect(ctx?.relay?.()).toBe(hot === undefined);
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(ctx?.relay?.()).toBe(hot === undefined);
        widgets.forEach((widget) => widget.stop());
        widgets = [];
      }
    }
  });

  it('reads the loaded collector relay value', async () => {
    for (const [hot, relay] of [
      [undefined, false],
      [HOT, true],
    ] as const) {
      vi.resetModules();
      const collector = fakeCollector(relay);
      const factory = vi.fn(() => collector);
      const root = await startWidget({ hot, collect: factory });
      expect(ctx?.relay?.()).toBe(!relay);
      send(root);
      await settle();
      expect(factory).toHaveBeenCalledTimes(1);
      expect(ctx?.relay?.()).toBe(relay);
      expect(ctx?.relay?.()).toBe(relay);
      expect(factory).toHaveBeenCalledTimes(1);
      widgets.forEach((widget) => widget.stop());
      widgets = [];
      document.body.innerHTML = '';
    }
  });

  it('preserves omitted mode and readiness failure retry', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    const shadow = host.attachShadow({ mode: 'open' });
    scope.__passback = { autoStart: false, fx: { addons: [(c: SubmitCtx) => (ctx = c)] } };
    const overlay = createOverlay({
      doc: document,
      root: shadow,
      host,
      selectorOf: () => 'div',
      onSubmit: vi.fn(),
    });
    expect(ctx).toBeDefined();
    expect(ctx!.relay).toBeUndefined();
    overlay.destroy();
    document.body.innerHTML = '';

    vi.resetModules();
    const collector = fakeCollector(true);
    let broken = true;
    const root = await startWidget({
      hot: HOT,
      collect: () => {
        if (broken) throw new Error('boom');
        return collector;
      },
    });
    send(root);
    await settle();
    expect(bubbleText(root)).toContain('Not sent: Passback could not finish loading.');
    expect(bubbleText(root)).not.toContain('boom');
    expect(ctx?.relay?.()).toBe(false);
    const retry = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Retry',
    );
    expect(retry).toBeDefined();
    broken = false;
    retry!.click();
    await settle();
    expect(collector.send).toHaveBeenCalledTimes(1);
    expect(ctx?.relay?.()).toBe(true);
  });
});
