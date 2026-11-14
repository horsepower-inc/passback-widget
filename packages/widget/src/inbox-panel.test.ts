// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openInboxPanel, type InboxPanelOpen } from './inbox-panel';
import { loadPanelOpen } from './panel-loader';

// happy-dom proves structure, declared styles and listener bookkeeping, not browser layout.
type Win = Window & { __passback?: { panel?: unknown } };
const VIEW = { innerWidth: 1000, innerHeight: 800 };
const ANCHOR = { top: 600, right: 960, bottom: 640, left: 700, width: 260, height: 40 };

function setup(rect: Partial<DOMRect> = ANCHOR) {
  const doc = document.implementation.createHTMLDocument('');
  const host = doc.createElement('div');
  doc.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const anchor = doc.createElement('div');
  root.append(anchor);
  anchor.getBoundingClientRect = () => ({ ...ANCHOR, ...rect }) as DOMRect;
  const win = { ...VIEW } as unknown as Window;
  return { doc, host, root, anchor, win };
}

const px = (value: string): number => Number.parseFloat(value);
const card = (root: ShadowRoot) => root.querySelector<HTMLElement>('[role="region"]');
const button = (root: ShadowRoot, name: string) =>
  root.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const panelStyle = (root: ShadowRoot) =>
  [...root.querySelectorAll('style')].map((style) => style.textContent ?? '').join('\n');

describe('inbox panel shell', () => {
  it('mounts the Inbox header and an empty content mount point', () => {
    const { root, anchor, win } = setup();
    const session = openInboxPanel({ root, win, anchor });
    expect(session).toBeDefined();
    const region = card(root);
    expect(region).toBe(session?.element);
    expect(region?.getAttribute('aria-label')).toBe('Inbox');
    expect(region?.querySelector('header')?.textContent).toContain('Inbox');
    const menu = button(root, 'Inbox menu');
    const close = button(root, 'Close Inbox');
    expect([menu?.textContent, menu?.type]).toEqual(['⋯', 'button']);
    expect([close?.textContent, close?.type]).toEqual(['✕', 'button']);
    expect(session?.content.parentElement).toBe(region);
    expect(session?.content.querySelector('[role="tablist"]')).not.toBeNull();
    expect(session?.content.querySelector('.pb-iv-list')?.textContent).toBe('Nothing here.');
    expect(region?.ownerDocument.body.contains(region)).toBe(false);
    expect(region?.getRootNode()).toBe(root);
  });

  it('mounts the view into the content and disposes it on close', () => {
    const { host, root, anchor, win } = setup();
    const session = openInboxPanel({ root, win, anchor });
    expect(session?.content.querySelector('.pb-iv')).not.toBeNull();
    const keys = vi.spyOn(session?.element as HTMLElement, 'removeEventListener');
    session?.close();
    expect(keys).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(session?.content.childNodes).toHaveLength(0);
    expect(root.querySelector('.pb-iv')).toBeNull();
    expect(host.isConnected).toBe(true);
  });

  it('positions the token-sized panel above the supplied anchor without changing page layout', () => {
    const { doc, root, anchor, win } = setup();
    const before = [
      doc.documentElement.style.cssText,
      doc.body.style.cssText,
      doc.body.childNodes.length,
    ];
    const element = openInboxPanel({ root, win, anchor })?.element;
    const style = element?.style;
    expect(style?.position).toBe('fixed');
    // Bottom edge sits one gap above the anchor's top; right edge aligns with the anchor's right.
    expect(style?.bottom).toMatch(/^calc\(\d+(\.\d+)?px \+ var\(--pb-space-gap\)\)$/);
    expect(
      Math.abs(px(style?.bottom.slice(5) ?? '') - (VIEW.innerHeight - ANCHOR.top)),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(px(style?.right ?? '') - (VIEW.innerWidth - ANCHOR.right))).toBeLessThanOrEqual(
      1,
    );
    expect(panelStyle(root)).toContain('width: min(420px, calc(100vw - 2 * var(--pb-space-gap)))');
    expect([
      doc.documentElement.style.cssText,
      doc.body.style.cssText,
      doc.body.childNodes.length,
    ]).toEqual(before);
  });

  it('mounts the clear menu on the menu button and disposes it on close', () => {
    const { root, anchor, win } = setup();
    const session = openInboxPanel({ root, win, anchor });
    expect(root.querySelector('style[data-pb-clear-style]')).not.toBeNull();
    button(root, 'Inbox menu')?.click();
    expect(root.querySelector('[role="menu"]')?.querySelectorAll('[role="menuitem"]')).toHaveLength(
      3,
    );
    session?.close();
    expect(root.querySelector('[role="menu"]')).toBeNull();
    expect(root.querySelector('style[data-pb-clear-style]')).toBeNull();
  });

  it('uses tokens without hex or rgb literals in panel styles', () => {
    const { root, anchor, win } = setup();
    const session = openInboxPanel({ root, win, anchor });
    const text = panelStyle(root) + (session?.element.getAttribute('style') ?? '');
    expect(text).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(text).not.toMatch(/rgba?\(/i);
    for (const token of [
      '--pb-color-surface',
      '--pb-color-text',
      '--pb-space-pad',
      '--pb-font-body',
      '--pb-radius-box',
      '--pb-shadow-box',
    ]) {
      expect(text).toContain(`var(${token})`);
    }
    expect(text).not.toMatch(/var\(--pb-[a-z-]+,/);
    // :host sets pointer-events none; the card turns them back on for its buttons.
    expect(session?.element.style.pointerEvents).toBe('auto');
  });

  it('closes once and removes owned DOM styles and listeners', () => {
    const { root, anchor, win } = setup();
    const onClose = vi.fn();
    const onMenu = vi.fn();
    const session = openInboxPanel({ root, win, anchor, onClose, onMenu });
    const menu = button(root, 'Inbox menu') as HTMLButtonElement;
    const close = button(root, 'Close Inbox') as HTMLButtonElement;
    const removed = [vi.spyOn(menu, 'removeEventListener'), vi.spyOn(close, 'removeEventListener')];
    menu.click();
    expect(onMenu).toHaveBeenCalledTimes(1);
    close.click();
    close.click();
    session?.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(root.childNodes).toHaveLength(1);
    expect(root.firstChild).toBe(anchor);
    for (const spy of removed) expect(spy).toHaveBeenCalledWith('click', expect.any(Function));
    menu.click();
    expect(onMenu).toHaveBeenCalledTimes(1);

    const second = setup();
    const quiet = vi.fn();
    const programmatic = openInboxPanel({ ...second, onClose: quiet });
    programmatic?.close();
    programmatic?.close();
    expect(quiet).not.toHaveBeenCalled();
    expect([...second.root.childNodes]).toEqual([second.anchor]);
  });

  it('contains construction and callback failures with the existing boundary', () => {
    const broken = setup();
    broken.anchor.getBoundingClientRect = () => {
      throw new Error('measure failed');
    };
    expect(openInboxPanel({ ...broken })).toBeUndefined();
    expect([...broken.root.childNodes]).toEqual([broken.anchor]);

    const { root, anchor, win } = setup();
    const onClose = vi.fn();
    openInboxPanel({
      root,
      win,
      anchor,
      onClose,
      onMenu: () => {
        throw new Error('menu failed');
      },
    });
    expect(() => button(root, 'Inbox menu')?.click()).not.toThrow();
    expect([...root.childNodes]).toEqual([anchor]);
    expect(onClose).not.toHaveBeenCalled();

    const other = setup();
    openInboxPanel({
      ...other,
      onClose: () => {
        throw new Error('close failed');
      },
    });
    expect(() => button(other.root, 'Close Inbox')?.click()).not.toThrow();
    expect([...other.root.childNodes]).toEqual([other.anchor]);
  });
});

function loaderSetup() {
  const doc = document.implementation.createHTMLDocument('');
  const added: HTMLScriptElement[] = [];
  vi.spyOn(doc.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    added.push(node as unknown as HTMLScriptElement);
    return node;
  });
  return { doc, win: {} as Win, added };
}

const fakeOpen: InboxPanelOpen = () => undefined;

describe('panel loader', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads the panel only on demand and shares pending loads per document', async () => {
    const { doc, win, added } = loaderSetup();
    expect(added).toHaveLength(0);
    const first = loadPanelOpen(doc, win, '/passback-panel.js');
    const second = loadPanelOpen(doc, win, '/passback-panel.js');
    expect(second).toBe(first);
    expect(added).toHaveLength(1);
    expect(added[0]?.async).toBe(true);
    expect(added[0]?.getAttribute('src')).toBe('/passback-panel.js');

    const other = loaderSetup();
    void loadPanelOpen(other.doc, other.win, '/passback-panel.js').catch(() => undefined);
    expect(other.added).toHaveLength(1);

    win.__passback = { panel: fakeOpen };
    added[0]?.dispatchEvent(new Event('load'));
    await expect(first).resolves.toBe(fakeOpen);
  });

  it('returns an existing panel registration without inserting a script', async () => {
    const { doc, win, added } = loaderSetup();
    win.__passback = { panel: fakeOpen };
    await expect(loadPanelOpen(doc, win, '/passback-panel.js')).resolves.toBe(fakeOpen);
    await expect(loadPanelOpen(doc, win, '')).resolves.toBe(fakeOpen);
    expect(added).toHaveLength(0);
  });

  it('rejects an empty panel URL without inserting a script', async () => {
    const { doc, win, added } = loaderSetup();
    await expect(loadPanelOpen(doc, win, '')).rejects.toThrow(/^passback: /);
    expect(added).toHaveLength(0);
  });

  it('rejects a panel script error and permits a later explicit load', async () => {
    const { doc, win, added } = loaderSetup();
    const failed = loadPanelOpen(doc, win, '/missing.js');
    added[0]?.dispatchEvent(new Event('error'));
    await expect(failed).rejects.toThrow(/^passback: .*\/missing\.js/);
    const retry = loadPanelOpen(doc, win, '/passback-panel.js');
    expect(retry).not.toBe(failed);
    expect(added).toHaveLength(2);
    win.__passback = { panel: fakeOpen };
    added[1]?.dispatchEvent(new Event('load'));
    await expect(retry).resolves.toBe(fakeOpen);
  });

  it('rejects missing or non-callable panel registration and permits a later explicit load', async () => {
    const { doc, win, added } = loaderSetup();
    const missing = loadPanelOpen(doc, win, '/passback-panel.js');
    added[0]?.dispatchEvent(new Event('load'));
    await expect(missing).rejects.toThrow(/^passback: /);

    win.__passback = { panel: 'not a function' };
    const wrong = loadPanelOpen(doc, win, '/passback-panel.js');
    expect(added).toHaveLength(2);
    added[1]?.dispatchEvent(new Event('load'));
    await expect(wrong).rejects.toThrow(/^passback: /);

    const later = loadPanelOpen(doc, win, '/passback-panel.js');
    expect(added).toHaveLength(3);
    win.__passback = { panel: fakeOpen };
    added[2]?.dispatchEvent(new Event('load'));
    await expect(later).resolves.toBe(fakeOpen);
  });
});
