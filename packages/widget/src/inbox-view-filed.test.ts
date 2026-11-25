// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { mountInboxView } from './inbox-view';

function setup(opts: { site?: boolean; filed?: unknown; relay?: unknown } = {}) {
  const doc = document.implementation.createHTMLDocument('');
  if (opts.site !== false) {
    const script = doc.createElement('script');
    script.setAttribute('data-passback-endpoint', 'https://x.test/ingest');
    doc.head.append(script);
  }
  const host = doc.createElement('div');
  const panel = doc.createElement('section');
  const content = doc.createElement('div');
  panel.append(content);
  host.append(panel);
  doc.body.append(host);
  const hot = { send: vi.fn(), on: vi.fn(), off: vi.fn() };
  const bag = { hot, caps: ['list'], filed: opts.filed, relay: opts.relay };
  const win = { __passback: bag, navigator: { platform: 'Linux' } } as unknown as Window;
  const onOpen = vi.fn();
  mountInboxView({ content, host, win, onOpen });
  const rows = () => [...content.querySelectorAll<HTMLElement>('[role="option"]')];
  const tabs = () => [...content.querySelectorAll<HTMLElement>('[role="tab"]')];
  return { host, panel, content, rows, tabs, onOpen };
}
const active = { subscription: 'active', tracker: 'Linear' };
const entries = [
  { comment: 'Button is cut off', ref: 'ISSUE-1' },
  { comment: 'Wrong colour', ref: 'ISSUE-2' },
];

describe('inbox view: filed comments', () => {
  it('lists the filed comments in Tracker as muted rows without an action and counts them', () => {
    const { content, rows, tabs } = setup({ filed: () => entries, relay: () => active });
    expect(tabs().map((t) => t.textContent)).toEqual(expect.arrayContaining(['All2', 'Tracker2']));
    expect(content.querySelector('.pb-iv-group')?.textContent).toBe('Tracker 2');
    expect(rows()).toHaveLength(2);
    for (const [i, node] of rows().entries()) {
      expect(node.hasAttribute('data-muted')).toBe(true);
      expect(node.querySelector('.pb-iv-n')?.textContent).toBe('');
      expect(node.querySelector('.pb-iv-comment')?.textContent).toBe(entries[i]?.comment);
      expect(node.querySelector('.pb-iv-line')?.textContent).toBe(
        `Filed in Linear · ${entries[i]?.ref}`,
      );
      expect(node.querySelector('button')).toBeNull();
    }
    tabs()
      .find((t) => t.dataset.key === 'tracker')
      ?.click();
    expect(rows()).toHaveLength(2);
  });

  it('shows no filed comment on a page without a site and ignores a missing or throwing getter', () => {
    expect(setup({ site: false, filed: () => entries }).rows()).toHaveLength(0);
    expect(setup({ filed: undefined }).rows()).toHaveLength(0);
    const throwing = (): never => {
      throw new Error('x');
    };
    expect(setup({ filed: throwing }).rows()).toHaveLength(0);
    const bad = [null, 3, { comment: 'a' }, { ref: 'ISSUE-3' }, { comment: 'ok', ref: 'ISSUE-4' }];
    const { rows } = setup({ filed: () => bad });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.querySelector('.pb-iv-line')?.textContent).toBe(
      'Filed in the tracker · ISSUE-4',
    );
  });

  it('does not open a filed row on Enter or on a click', () => {
    const { panel, rows, onOpen, content } = setup({ filed: () => entries });
    const node = rows()[0] as HTMLElement;
    node.click();
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(content.querySelector('.pb-it-box')).toBeNull();
    expect(rows()).toHaveLength(2);
  });
});
