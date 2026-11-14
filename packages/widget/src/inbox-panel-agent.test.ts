// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { openInboxPanel } from './inbox-panel';

const ANCHOR = { top: 600, right: 960, bottom: 640, left: 700, width: 260, height: 40 };

function setup() {
  const doc = document.implementation.createHTMLDocument('');
  const host = doc.createElement('div');
  doc.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  const anchor = doc.createElement('div');
  root.append(anchor);
  anchor.getBoundingClientRect = () => ANCHOR as DOMRect;
  const win = { innerWidth: 1000, innerHeight: 800 } as unknown as Window;
  return { root, anchor, win };
}

const line = (root: ShadowRoot) => root.querySelector<HTMLElement>('[role="status"]');
const styles = (root: ShadowRoot) =>
  [...root.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');

describe('inbox panel agent line', () => {
  it('shows the agent line under the header and updates it in place', () => {
    const { root, anchor, win } = setup();
    const session = openInboxPanel({ root, win, anchor });
    session?.setAgent({ state: 'waiting', agent: 'claude-code', since: 'now' });
    const first = line(root);
    expect(first?.previousElementSibling?.tagName).toBe('HEADER');
    expect(first?.parentElement).toBe(session?.element);
    expect(first?.getAttribute('aria-live')).toBe('polite');
    expect(first?.getAttribute('data-state')).toBe('waiting');
    expect(first?.textContent).toContain('Claude Code waiting');
    session?.setAgent({ state: 'working', agent: 'claude-code', since: 'now' });
    expect(root.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(line(root)).toBe(first);
    expect(first?.getAttribute('data-state')).toBe('working');
    expect(first?.textContent).toContain('Claude Code working');
    session?.setAgent({ state: 'absent' });
    expect(first?.getAttribute('data-state')).toBe('absent');
    expect(first?.textContent).toContain('No agent session: type /passback');
  });

  it('removes the line for a snapshot without an agent and with the panel closed', () => {
    const { root, anchor, win } = setup();
    const session = openInboxPanel({ root, win, anchor });
    session?.setAgent({ state: 'absent' });
    expect(line(root)).not.toBeNull();
    session?.setAgent(undefined);
    expect(line(root)).toBeNull();
    session?.setAgent({ state: 'absent' });
    session?.close();
    expect(line(root)).toBeNull();
    expect(() => session?.setAgent({ state: 'absent' })).not.toThrow();
    expect(line(root)).toBeNull();
  });

  it('leaves the shell unchanged until setAgent is called', () => {
    const a = setup();
    const b = setup();
    const plain = openInboxPanel({ root: a.root, win: a.win, anchor: a.anchor });
    const touched = openInboxPanel({ root: b.root, win: b.win, anchor: b.anchor });
    touched?.setAgent({ state: 'absent' });
    touched?.setAgent(undefined);
    expect(touched?.element.outerHTML).toBe(plain?.element.outerHTML);
    expect(a.root.innerHTML).toBe(b.root.innerHTML);
  });

  it('uses tokens without hex or rgb literals in the agent line styles', () => {
    const { root, anchor, win } = setup();
    openInboxPanel({ root, win, anchor });
    const css = styles(root);
    const block = css.slice(css.indexOf('.pb-inbox-agent'));
    expect(block).toContain('var(--pb-color-ok)');
    expect(block).toContain('var(--pb-color-accent)');
    expect(block).toContain('var(--pb-color-text-muted)');
    expect(block).toContain('var(--pb-font-small)');
    expect(block).toContain('var(--pb-space-gap)');
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(block).not.toMatch(/var\([^)]*,/);
  });
});
