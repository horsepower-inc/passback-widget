// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { SCHEMES, TOKENS } from './tokens';
import { createTray, trayRules, TRAY_CLASS } from './tray-view';

function setup(corner?: 'bottom-left') {
  // onDiscardAll is returned so the header case can read it
  const onDiscardAll = vi.fn();
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const onSendAll = vi.fn();
  const tray = createTray(root, { onSendAll, onDiscardAll, corner });
  return { root, tray, onSendAll, onDiscardAll };
}

const button = (root: ShadowRoot) => root.querySelector('.pb-send') as HTMLButtonElement;
const rows = (...comments: string[]) =>
  comments.map((comment, i) => ({ n: i + 1, comment, act: vi.fn() }));
const named = (root: ShadowRoot, text: string) =>
  [...root.querySelectorAll('button')].filter((b) => b.textContent === text);
const toggle = (root: ShadowRoot) => root.querySelector<HTMLButtonElement>('.pb-toggle')!;

describe('tray view', () => {
  it('shows nothing while no comment is kept', () => {
    const { root, tray } = setup();
    expect(root.querySelector(`.${TRAY_CLASS.tray}`)).toBeNull();
    tray.render(rows('a'));
    tray.render([]);
    expect(root.querySelector(`.${TRAY_CLASS.tray}`)).toBeNull();
  });

  it('R6 lists unsent comments as one-line rows with number, text and a trash button', () => {
    const { root, tray } = setup();
    const list = rows('one', 'two', 'three');
    tray.render(list);
    expect(tray.element.getAttribute('role')).toBe('region');
    expect(tray.element.getAttribute('aria-label')).toBe('Kept comments');
    const items = [...root.querySelectorAll(`.${TRAY_CLASS.list} li`)];
    expect(items.map((li) => li.textContent)).toEqual(['1one', '2two', '3three']);
    const trash = items.map((li) => li.querySelector('button')!);
    expect(trash.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Delete comment 1',
      'Delete comment 2',
      'Delete comment 3',
    ]);
    trash[1]!.click();
    expect(list[1]!.act.mock.calls).toEqual([['delete']]);
    expect(trayRules()).toContain('calc(var(--pb-space-gap) * 3.5)');
    expect(root.querySelector('.pb-note')?.textContent).toBe('Click to add more');
    expect(button(root).textContent).toBe('Send all');
    expect(button(root).type).toBe('button');
  });

  it('R6 header says N to send and Discard all calls onDiscardAll', () => {
    const { root, tray, onDiscardAll } = setup();
    tray.render(rows('one', 'two'));
    expect(toggle(root).textContent).toBe('2 to send');
    expect(toggle(root).getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('.pb-tray')?.textContent).not.toContain('on this page');
    named(root, 'Discard all')[0]!.click();
    expect(onDiscardAll).toHaveBeenCalledTimes(1);
  });

  it('R6 collapses to one N to send pill and expands again, keeping the choice across renders', () => {
    const { root, tray } = setup();
    tray.render(rows('one', 'two'));
    toggle(root).click();
    expect(tray.element.hasAttribute('data-collapsed')).toBe(true);
    expect(toggle(root).getAttribute('aria-expanded')).toBe('false');
    tray.render(rows('one', 'two', 'three'));
    expect(tray.element.hasAttribute('data-collapsed')).toBe(true);
    expect(toggle(root).textContent).toBe('3 to send');
    tray.render([]);
    tray.render(rows('one'));
    expect(tray.element.hasAttribute('data-collapsed')).toBe(true);
    toggle(root).click();
    expect(tray.element.hasAttribute('data-collapsed')).toBe(false);
    expect(toggle(root).getAttribute('aria-expanded')).toBe('true');
    tray.setSending(true);
    tray.showError('offline');
    tray.setSending(true);
    toggle(root).click();
    toggle(root).click();
    expect(button(root).disabled).toBe(true);
    expect(root.querySelectorAll('[data-role="error"]').length).toBe(2);
    expect(trayRules()).toMatch(/\[data-collapsed\] \{ width: auto;[^}]*border-radius: var\(/);
    expect(trayRules()).toMatch(/li \{ display: flex; flex: none;/);
    expect(trayRules()).not.toMatch(/stroke-width: [\d.]+;|opacity: [\d.]+;/);
  });

  it('R6 renders no Hide, Go to or status controls', () => {
    const { root, tray } = setup();
    tray.render(rows('a', 'b'));
    const texts = [...root.querySelectorAll('button')].map((b) => b.textContent);
    expect(
      texts.filter((t) => ['Hide', 'Show', 'Go to', 'Delete', 'Hide all marks'].includes(t!)),
    ).toEqual([]);
    expect(root.querySelector('em, small')).toBeNull();
  });

  it('renders a comment as literal text', () => {
    const { root, tray } = setup();
    tray.render(rows('<img src=x>'));
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector(`.${TRAY_CLASS.list} span`)?.textContent).toBe('<img src=x>');
  });

  it('calls onSendAll when the send button is clicked', () => {
    const { root, tray, onSendAll } = setup();
    tray.render(rows('a', 'b'));
    button(root).click();
    expect(onSendAll).toHaveBeenCalledTimes(1);
  });

  it('locks the button and says Sending… while sending', () => {
    const { root, tray } = setup();
    tray.render(rows('a'));
    tray.setSending(true);
    expect(button(root).disabled).toBe(true);
    expect(root.querySelector('.pb-note')?.textContent).toBe('Sending…');
    tray.setSending(false);
    expect(button(root).disabled).toBe(false);
    expect(root.querySelector('.pb-note')?.textContent).toBe('Click to add more');
  });

  it('shows Not sent with the reason and keeps the list after a failure', () => {
    const { root, tray } = setup();
    tray.render(rows('a', 'b'));
    tray.setSending(true);
    tray.showError('offline');
    tray.showError('timeout');
    const lines = [...root.querySelectorAll('[data-role="error"]')].map((p) => p.textContent);
    expect(lines).toEqual(['Not sent. timeout', 'Your comments are kept.']);
    expect(root.querySelectorAll(`.${TRAY_CLASS.list} li`).length).toBe(2);
    expect(button(root).disabled).toBe(false);
    tray.render(rows('a'));
    tray.showError('x');
    expect(root.querySelectorAll('[data-role="error"]')[1]?.textContent).toBe(
      'Your comment is kept.',
    );
  });

  it('goes back to the plain state on the next render', () => {
    const { root, tray } = setup();
    tray.render(rows('a'));
    tray.setSending(true);
    tray.showError('offline');
    tray.render(rows('a', 'b'));
    expect(root.querySelector('[data-role="error"]')).toBeNull();
    expect(button(root).disabled).toBe(false);
    expect(root.querySelector('.pb-note')?.textContent).toBe('Click to add more');
  });

  it('carries data-corner for a corner other than bottom right', () => {
    expect(setup('bottom-left').tray.element.dataset.corner).toBe('bottom-left');
    expect(setup().tray.element.hasAttribute('data-corner')).toBe(false);
  });

  it('installs its rules once per root', () => {
    const { root } = setup();
    createTray(root, { onSendAll: () => {} });
    const styles = root.querySelectorAll('style[data-pb-tray-styles]');
    expect(styles.length).toBe(1);
    expect(styles[0]?.textContent).toBe(trayRules());
  });

  it('uses only custom properties the style kit declares and no colour literal', () => {
    const rules = trayRules();
    const known = new Set([...Object.keys(TOKENS), ...Object.keys(SCHEMES.dark)]);
    const used = [...rules.matchAll(/var\((--pb-[\w-]+)/g)].map((m) => m[1] as string);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !known.has(name))).toEqual([]);
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  });

  it('renders the notice as text and locks the trash of a locked row', () => {
    const { root, tray } = setup();
    tray.render([], '<b>Removed</b>');
    expect(root.querySelector('p')?.textContent).toBe('<b>Removed</b>');
    expect(root.querySelector('b')).toBeNull();
    tray.render([{ n: 1, comment: '<i>x</i>', act: vi.fn(), locked: true }]);
    expect(root.querySelector<HTMLButtonElement>('.pb-list button')!.disabled).toBe(true);
    expect(root.querySelector('i')).toBeNull();
  });

  it('R6 the toggle is a chevron icon button with a title that follows the state', () => {
    const { root, tray } = setup();
    tray.render(rows('one', 'two'));
    const t = toggle(root);
    expect(t.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(t.textContent).toBe('2 to send');
    expect([t.title, t.getAttribute('aria-expanded')]).toEqual(['Collapse', 'true']);
    t.click();
    expect([t.title, t.getAttribute('aria-expanded')]).toEqual(['Expand', 'false']);
    t.click();
    expect([t.title, t.getAttribute('aria-expanded')]).toEqual(['Collapse', 'true']);
  });

  it('R6 the toggle rules give a 24 px hit area, a focus state and a reduced-motion stop', () => {
    const rules = trayRules();
    expect(rules).not.toMatch(/\\25BE|\\25B8/);
    const rule = rules.split('\n').find((r) => r.startsWith('.pb-head .pb-toggle {'))!;
    expect(rule).toContain('min-width: calc(var(--pb-space-gap) * 3)');
    expect(rule).toContain('min-height: calc(var(--pb-space-gap) * 3)');
    expect(rules).toContain('.pb-toggle:focus-visible');
    expect(rules).toMatch(/\[aria-expanded='false'\] svg \{ transform: rotate\(/);
    expect(rules).toMatch(/prefers-reduced-motion: reduce\) \{[^}]*transition: none/);
  });

  it('removes itself on destroy', () => {
    const { root, tray } = setup();
    tray.render(rows('a'));
    tray.destroy();
    expect(root.querySelector(`.${TRAY_CLASS.tray}`)).toBeNull();
  });
});
