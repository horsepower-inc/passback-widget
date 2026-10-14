// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOST_ATTRIBUTE } from './mount';
import { PR_STORAGE_KEY } from './pr-link';
import type { Widget } from './index';

let widgets: Widget[] = [];
async function startWidget(): Promise<Widget> {
  (window as Window & { __passback?: { autoStart?: boolean } }).__passback = { autoStart: false };
  const { start } = await import('./index');
  const widget = start(document, window);
  widgets.push(widget);
  return widget;
}
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  widgets.forEach((widget) => widget.stop());
  widgets = [];
  document.body.innerHTML = '';
  window.location.hash = '';
  window.sessionStorage.clear();
  delete (window as Window & { __passback?: unknown }).__passback;
  vi.restoreAllMocks();
});

describe('widget entry: pull request link', () => {
  it('start() keeps the pull request number of the review link for the tab', async () => {
    window.location.hash = '#pb-pr104';

    await startWidget();

    expect(window.sessionStorage.getItem(PR_STORAGE_KEY)).toBe('104');
  });
  it('start() keeps nothing on a page with no review link', async () => {
    await startWidget();

    expect(window.sessionStorage.getItem(PR_STORAGE_KEY)).toBeNull();
  });
  it('start() mounts the widget when session storage throws', async () => {
    window.location.hash = '#pb-pr104';
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    await startWidget();

    expect(document.querySelector(`[${HOST_ATTRIBUTE}]`)).not.toBeNull();
  });
});
