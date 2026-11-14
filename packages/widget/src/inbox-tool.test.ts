// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountHelp } from './help';
import type { InboxPanelOpen, InboxPanelOptions, InboxPanelSession } from './inbox-panel';
import type { MarkRow } from './tray-view';

// happy-dom proves structure, declared styles and listener bookkeeping, not browser layout.
type Scope = { __passback?: { panel?: unknown; kept?: () => readonly MarkRow[] } };
const scope = window as unknown as Scope;
const SRC = '/@passback/panel.js';
let added: HTMLScriptElement[] = [];

beforeEach(() => {
  // A fresh panel-loader per test: its pending-load cache is per document.
  vi.resetModules();
  added = [];
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    added.push(node as unknown as HTMLScriptElement);
    return node;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete scope.__passback;
  document.body.innerHTML = '';
});

function nameChunk(value: string): void {
  const script = document.createElement('script');
  script.setAttribute('data-passback-panel', value);
  document.body.append(script);
}

async function setup(rows: readonly MarkRow[] = []) {
  const { inboxTool } = await import('./inbox-tool');
  const host = document.body.appendChild(document.createElement('div'));
  const root = host.attachShadow({ mode: 'open' });
  const bar = document.createElement('div');
  bar.className = 'pb-palette';
  bar.toggleAttribute('data-open', true);
  root.append(bar);
  mountHelp(bar);
  inboxTool({ root, host, rows: { rows: () => rows } });
  const tool = () => root.querySelector<HTMLButtonElement>("button[data-act='inbox']");
  return { host, root, bar, tool };
}

function fakePanel() {
  const close = vi.fn();
  const calls: InboxPanelOptions[] = [];
  const open: InboxPanelOpen = (opts) => {
    calls.push(opts);
    const element = document.createElement('section');
    return { element, content: element, close, setAgent: vi.fn() } satisfies InboxPanelSession;
  };
  return { open, calls, close };
}

/** The synthetic script load panel-loader expects: the chunk registers its opener, then `load` fires. */
function loadChunk(open: InboxPanelOpen): void {
  scope.__passback = Object.assign(scope.__passback ?? {}, { panel: open });
  added.at(-1)?.dispatchEvent(new Event('load'));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const styles = (root: ShadowRoot) =>
  [...root.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n');
const orderOf = (css: string, selector: string) =>
  Number(new RegExp(`${selector}[^{]*\\{[^}]*order: (\\d+)`).exec(css)?.[1]);

describe('inbox tool', () => {
  it('adds no Inbox tool when the widget script names no panel chunk', async () => {
    nameChunk('   ');
    const { root, bar, tool } = await setup();
    expect(tool()).toBeNull();
    expect(bar.querySelector('.pb-palette-divider')).toBeNull();
    expect(root.querySelector('style[data-pb-inbox-tool-styles]')).toBeNull();
    expect(scope.__passback?.kept).toBeUndefined();
    expect(added).toHaveLength(0);
  });

  it('adds the Inbox tool after a divider and next to ? when the script names the panel chunk', async () => {
    nameChunk(` ${SRC} `);
    const { root, bar, tool } = await setup();
    const button = tool();
    expect(button?.parentElement).toBe(bar);
    expect([button?.type, button?.title, button?.getAttribute('aria-label')]).toEqual([
      'button',
      'Inbox',
      'Inbox',
    ]);
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.style.getPropertyValue('--pb-i')).toBe('4');
    const svg = button?.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.querySelector('path')?.getAttribute('d')).toBeTruthy();
    const divider = bar.querySelector<HTMLElement>('span.pb-palette-divider');
    expect(divider?.getAttribute('aria-hidden')).toBe('true');
    expect(divider?.nextElementSibling).toBe(button);
    const css = styles(root);
    expect(root.querySelectorAll('style[data-pb-inbox-tool-styles]')).toHaveLength(1);
    expect(css).toMatch(/\.pb-palette-divider \{[^}]*width: 1px; height: 20px;/);
    expect(css).toMatch(/\.pb-palette-divider \{[^}]*background: var\(--pb-color-border\)/);
    const inbox = root.querySelector('style[data-pb-inbox-tool-styles]')?.textContent ?? '';
    expect(inbox).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    const divide = orderOf(css, '\\.pb-palette-divider');
    const self = orderOf(css, "button\\[data-act='inbox'\\]");
    const help = orderOf(css, "button\\[data-act='help'\\]");
    expect([divide, self, help]).toEqual([89, 90, 99]);
    expect(added).toHaveLength(0);
  });

  it('loads the panel on the first click, opens it above the tool and presses the tool', async () => {
    nameChunk(SRC);
    const { root, tool } = await setup();
    const panel = fakePanel();
    tool()?.click();
    expect(tool()?.getAttribute('aria-pressed')).toBe('true');
    expect(added).toHaveLength(1);
    expect(added[0]?.getAttribute('src')).toBe(SRC);
    tool()?.click();
    expect(added).toHaveLength(1);
    loadChunk(panel.open);
    await settle();
    expect(panel.calls).toHaveLength(1);
    expect(panel.calls[0]?.root).toBe(root);
    expect(panel.calls[0]?.win).toBe(window);
    expect(panel.calls[0]?.anchor).toBe(tool());
    expect(panel.calls[0]?.onClose).toBeTypeOf('function');
    expect(panel.calls[0]?.onMenu).toBeTypeOf('function');
    expect(() => panel.calls[0]?.onMenu?.()).not.toThrow();
    expect(tool()?.getAttribute('aria-pressed')).toBe('true');
  });

  it('hides the panel on the second click and unpresses the tool', async () => {
    nameChunk(SRC);
    const { tool } = await setup();
    const panel = fakePanel();
    tool()?.click();
    loadChunk(panel.open);
    await settle();
    tool()?.click();
    expect(panel.close).toHaveBeenCalledTimes(1);
    expect(tool()?.getAttribute('aria-pressed')).toBe('false');
    tool()?.click();
    await settle();
    expect(panel.calls).toHaveLength(2);
    expect(added).toHaveLength(1);
    expect(tool()?.getAttribute('aria-pressed')).toBe('true');
  });

  it('unpresses the tool when the panel close button hides the panel', async () => {
    nameChunk(SRC);
    const { tool } = await setup();
    const panel = fakePanel();
    tool()?.click();
    loadChunk(panel.open);
    await settle();
    panel.calls[0]?.onClose?.();
    expect(tool()?.getAttribute('aria-pressed')).toBe('false');
    tool()?.click();
    await settle();
    expect(panel.calls).toHaveLength(2);
    expect(panel.close).not.toHaveBeenCalled();
  });

  it('hides the panel when the palette closes and opens nothing when it closed during loading', async () => {
    nameChunk(SRC);
    const { bar, tool } = await setup();
    const panel = fakePanel();
    tool()?.click();
    expect(added).toHaveLength(1);
    bar.removeAttribute('data-open');
    await settle();
    expect(tool()?.getAttribute('aria-pressed')).toBe('false');
    loadChunk(panel.open);
    await settle();
    expect(panel.calls).toHaveLength(0);
    expect(tool()?.getAttribute('aria-pressed')).toBe('false');

    bar.toggleAttribute('data-open', true);
    await settle();
    tool()?.click();
    await settle();
    expect(panel.calls).toHaveLength(1);
    bar.removeAttribute('data-open');
    await settle();
    expect(panel.close).toHaveBeenCalledTimes(1);
    expect(tool()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('stays unpressed when the panel chunk fails to load and tries again on the next click', async () => {
    nameChunk(SRC);
    const { tool } = await setup();
    const panel = fakePanel();
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    tool()?.click();
    added[0]?.dispatchEvent(new Event('error'));
    await settle();
    expect(tool()?.getAttribute('aria-pressed')).toBe('false');
    expect(panel.calls).toHaveLength(0);
    tool()?.click();
    expect(added).toHaveLength(2);
    loadChunk(panel.open);
    await settle();
    expect(panel.calls).toHaveLength(1);
    expect(tool()?.getAttribute('aria-pressed')).toBe('true');
    window.removeEventListener('unhandledrejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('publishes the kept comments as window.__passback.kept and removes everything on dispose', async () => {
    nameChunk(SRC);
    const rows: MarkRow[] = [{ n: 1, comment: 'Too tight', locked: false, act: vi.fn() }];
    const { host, root, bar, tool } = await setup(rows);
    expect(scope.__passback?.kept?.()).toBe(rows);
    const panel = fakePanel();
    tool()?.click();
    loadChunk(panel.open);
    await settle();
    const button = tool();
    host.dispatchEvent(new Event('passback:dispose'));
    expect(panel.close).toHaveBeenCalledTimes(1);
    expect(tool()).toBeNull();
    expect(bar.querySelector('.pb-palette-divider')).toBeNull();
    expect(root.querySelector('style[data-pb-inbox-tool-styles]')).toBeNull();
    expect(scope.__passback && 'kept' in scope.__passback).toBe(false);
    button?.click();
    bar.removeAttribute('data-open');
    await settle();
    expect(added).toHaveLength(1);
    expect(panel.close).toHaveBeenCalledTimes(1);
  });
});
