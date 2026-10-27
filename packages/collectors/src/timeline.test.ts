// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { Timeline } from '@passback/schema';
import { startTimeline, type TimelineHandle } from './timeline';

let handle: TimelineHandle | undefined;

afterEach(() => {
  handle?.stop();
  handle = undefined;
  window.history.replaceState({}, '', '/');
});

describe('startTimeline', () => {
  it('restores console, history and listeners on stop', () => {
    const originalError = window.console.error;
    const originalPushState = window.history.pushState;
    document.body.innerHTML = '<button id="btn">Go</button>';

    handle = startTimeline(window, () => 0);
    handle.stop();

    expect(window.console.error).toBe(originalError);
    expect(window.history.pushState).toBe(originalPushState);

    document.getElementById('btn')!.click();

    expect(handle.snapshot()).toEqual([]);
  });

  it('stop twice is harmless', () => {
    handle = startTimeline(window, () => 0);

    expect(() => {
      handle?.stop();
      handle?.stop();
    }).not.toThrow();
  });

  it('never records a typed input value', () => {
    document.body.innerHTML = '<input id="pw" />';
    const input = document.getElementById('pw') as HTMLInputElement;
    handle = startTimeline(window, () => 0);

    input.value = 'hunter2';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(JSON.stringify(handle.snapshot())).not.toContain('hunter2');
  });

  it('validates a snapshot against the schema Timeline', () => {
    document.body.innerHTML = '<button id="btn">Go</button>';
    const originalError = window.console.error;
    window.console.error = () => {};
    handle = startTimeline(window, () => 0);

    console.error('boom');
    document.getElementById('btn')!.click();
    window.history.pushState({}, '', '/next');

    const snapshot = handle.snapshot();
    handle.stop();
    window.console.error = originalError;
    handle = undefined;

    expect(() => Timeline.parse(snapshot)).not.toThrow();
  });
});
