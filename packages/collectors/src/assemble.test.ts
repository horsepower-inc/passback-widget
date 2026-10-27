// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { parsePayload, type TimelineEvent } from '@passback/schema';
import { assemblePayload } from './assemble';
import { trimPayload, payloadBytes, MARK_MAX_BYTES } from './trim';
import type { Fiber } from './react';

function attachFiber(el: Element, fiber: Fiber): void {
  (el as unknown as Record<string, Fiber>)['__reactFiber$test'] = fiber;
}

afterEach(() => {
  delete (window as unknown as { __passback?: unknown }).__passback;
});

describe('assemblePayload', () => {
  it('returns a payload that parsePayload accepts', () => {
    document.body.innerHTML = '<div id="el">Hello</div>';
    const el = document.getElementById('el')!;

    const payload = assemblePayload({ el, comment: 'Broken', win: window, timeline: [] });

    expect(() => parsePayload(payload)).not.toThrow();
  });

  it('carries the comment in intent and sets no category', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;

    const payload = assemblePayload({ el, comment: 'Button is broken', win: window, timeline: [] });

    expect(payload.intent).toEqual({ comment: 'Button is broken', annotations: [] });
    expect('category' in payload.intent).toBe(false);
  });

  it('reads code.buildId from window.__passback', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    (window as unknown as { __passback?: { buildId?: string } }).__passback = { buildId: 'abc123' };

    const payload = assemblePayload({ el, comment: 'x', win: window, timeline: [] });

    expect(payload.code.buildId).toBe('abc123');
  });

  it('omits code.buildId when the global is absent', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;

    const payload = assemblePayload({ el, comment: 'x', win: window, timeline: [] });

    expect('buildId' in payload.code).toBe(false);
  });

  it('reports framework unknown for a plain element', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;

    const payload = assemblePayload({ el, comment: 'x', win: window, timeline: [] });

    expect(payload.code.framework).toBe('unknown');
    expect(payload.code.chain).toEqual([]);
  });

  it('reports the react chain for an element with a fiber', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    attachFiber(el, { tag: 0, type: function App() {}, return: null });

    const payload = assemblePayload({ el, comment: 'x', win: window, timeline: [] });

    expect(payload.code.framework).toBe('react');
    expect(payload.code.chain).toEqual([{ name: 'App' }]);
  });

  it('uses the Vue chain when the element has no React fiber', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    (el as unknown as Record<string, unknown>).__vueParentComponent = {
      type: { name: 'VueCard' },
      parent: null,
    };

    const payload = assemblePayload({ el, comment: 'x', win: window, timeline: [] });

    expect(payload.code.framework).toBe('vue');
    expect(payload.code.chain).toEqual([{ name: 'VueCard' }]);
    expect(() => parsePayload(payload)).not.toThrow();
  });

  it('keeps the React chain when the element has a fiber and an instance', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    attachFiber(el, { tag: 0, type: function App() {}, return: null });
    (el as unknown as Record<string, unknown>).__vueParentComponent = {
      type: { name: 'VueCard' },
      parent: null,
    };

    const payload = assemblePayload({ el, comment: 'x', win: window, timeline: [] });

    expect(payload.code.framework).toBe('react');
    expect(payload.code.chain).toEqual([{ name: 'App' }]);
  });

  it('passes the timeline through unchanged', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    const timeline: TimelineEvent[] = [{ t: 1, kind: 'navigation', from: '/a', to: '/b' }];

    const payload = assemblePayload({ el, comment: 'x', win: window, timeline });

    expect(payload.timeline).toBe(timeline);
  });

  it('produces a payload that trimPayload can shrink under the limit', () => {
    document.body.innerHTML = '<div id="el"></div>';
    const el = document.getElementById('el')!;
    const timeline: TimelineEvent[] = Array.from({ length: 3000 }, (_, t) => ({
      t,
      kind: 'console',
      level: 'error',
      message: 'm'.repeat(100),
    }));

    const payload = assemblePayload({ el, comment: 'x', win: window, timeline });

    expect(payloadBytes(payload)).toBeGreaterThan(MARK_MAX_BYTES);

    const result = trimPayload(payload);

    expect(result.fits).toBe(true);
    expect(payloadBytes(result.payload)).toBeLessThanOrEqual(MARK_MAX_BYTES);
  });
});
