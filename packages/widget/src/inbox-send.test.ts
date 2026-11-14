// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { destCounts, destSwitch, footerNode } from './inbox-send';
import { mountInboxView } from './inbox-view';

const doc = document.implementation.createHTMLDocument('');
const half = (node: HTMLElement, dest: string) =>
  node.querySelector<HTMLButtonElement>(`[data-dest="${dest}"]`)!;
const info = (extra = {}) => ({
  shown: 3,
  counts: { agent: 2, tracker: 1 },
  site: true,
  offer: 'Linear' as string | undefined,
  ...extra,
});

describe('inbox send', () => {
  it('draws the switch with the agent pressed by default and the tracker name when it is offered', () => {
    const node = destSwitch(doc, 'agent', 'Linear', vi.fn());
    expect(node.className).toBe('pb-iv-dest');
    expect(node.getAttribute('role')).toBe('group');
    expect(node.getAttribute('aria-label')).toBe('Send to');
    expect(half(node, 'agent').textContent).toBe('Agent');
    expect(half(node, 'agent').getAttribute('aria-pressed')).toBe('true');
    expect(half(node, 'tracker').textContent).toBe('Linear');
    expect(half(node, 'tracker').getAttribute('aria-pressed')).toBe('false');
    expect(half(node, 'tracker').disabled).toBe(false);
    const filed = destSwitch(doc, 'tracker', 'Linear', vi.fn());
    expect(half(filed, 'tracker').getAttribute('aria-pressed')).toBe('true');
  });

  it('disables the tracker half with Connect a tracker when nothing is offered', () => {
    const node = destSwitch(doc, 'agent', undefined, vi.fn());
    expect(half(node, 'tracker').textContent).toBe('Tracker');
    expect(half(node, 'tracker').disabled).toBe(true);
    expect(half(node, 'tracker').title).toBe('Connect a tracker');
    expect(half(node, 'agent').disabled).toBe(false);
  });

  it('a click on a half asks the row to go to the agent or to the tracker and nothing else', () => {
    const pick = vi.fn();
    const outer = vi.fn();
    const row = doc.createElement('div');
    row.addEventListener('click', outer);
    row.append(destSwitch(doc, 'agent', 'Linear', pick));
    half(row, 'tracker').click();
    half(row, 'agent').click();
    expect(pick.mock.calls).toEqual([['tracker'], ['agent']]);
    expect(outer).not.toHaveBeenCalled();
  });

  it('the footer counts the agent comments and the tracker comments apart and disables an empty button', () => {
    expect(destCounts([{}, { dest: 'agent' }, { dest: 'tracker' }])).toEqual({
      agent: 2,
      tracker: 1,
    });
    const host = doc.createElement('div');
    const foot = footerNode(doc, false, host, info());
    expect(foot.querySelector('.pb-iv-total')?.textContent).toBe('3 comments');
    expect(foot.querySelector('.pb-iv-send')?.textContent).toBe('Send 2 to agent Ctrl+Enter');
    expect(foot.querySelector('.pb-iv-file')?.textContent).toBe(
      'File 1 in Linear Ctrl+Shift+Enter',
    );
    const mac = footerNode(doc, true, host, info());
    expect(mac.querySelector('.pb-iv-send')?.textContent).toBe('Send 2 to agent ⌘↵');
    expect(mac.querySelector('.pb-iv-file')?.textContent).toBe('File 1 in Linear ⌘⇧↵');
    const empty = footerNode(doc, false, host, info({ counts: { agent: 0, tracker: 0 } }));
    expect(empty.querySelector<HTMLButtonElement>('.pb-iv-send')?.disabled).toBe(true);
    expect(empty.querySelector<HTMLButtonElement>('.pb-iv-file')?.disabled).toBe(true);
    const none = footerNode(doc, false, host, info({ offer: undefined }));
    expect(none.querySelector('.pb-iv-file')?.textContent).toBe('Connect a tracker');
    expect(none.querySelector<HTMLButtonElement>('.pb-iv-file')?.disabled).toBe(true);
  });

  it('the buttons dispatch passback:send-all with the destination in the detail', () => {
    const host = doc.createElement('div');
    const sent = vi.fn();
    host.addEventListener('passback:send-all', (e) => sent((e as CustomEvent).detail));
    const foot = footerNode(doc, false, host, info());
    foot.querySelector<HTMLButtonElement>('.pb-iv-send')?.click();
    foot.querySelector<HTMLButtonElement>('.pb-iv-file')?.click();
    expect(sent.mock.calls).toEqual([[{ dest: 'agent' }], [{ dest: 'tracker' }]]);
  });

  it('shows no switch and no file button on a page without a site', () => {
    const page = document.implementation.createHTMLDocument('');
    const host = page.createElement('div');
    const content = page.createElement('div');
    host.append(content);
    page.body.append(host);
    const kept = [{ n: 1, comment: 'a', act: vi.fn() }];
    const win = {
      __passback: { kept, relay: () => ({ subscription: 'active', tracker: 'Linear' }) },
      navigator: { platform: 'Linux' },
    } as unknown as Window;
    mountInboxView({ content, host, win });
    expect(content.querySelector('.pb-iv-dest')).toBeNull();
    expect(content.querySelector('.pb-iv-file')).toBeNull();
    expect(content.querySelector('.pb-iv-send')).not.toBeNull();
    expect(
      footerNode(page, false, host, info({ site: false })).querySelector('.pb-iv-file'),
    ).toBeNull();
  });
});
