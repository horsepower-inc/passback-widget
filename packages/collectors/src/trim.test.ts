import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Payload, type Timeline } from '@passback/schema';
import { MARK_MAX_BYTES, payloadBytes, trimPayload } from './trim';

function basePayload(overrides: Partial<Payload> = {}): Payload {
  return {
    schemaVersion: 1,
    code: { framework: 'react', chain: [{ name: 'Root' }], buildId: 'abc123' },
    element: {
      selectors: [{ kind: 'css', value: 'button' }],
      tag: 'button',
      attrs: {},
      text: 'Click',
      outerHTML: '<button>Click</button>',
    },
    visual: {
      rects: {
        self: { x: 0, y: 0, width: 10, height: 10 },
        parent: { x: 0, y: 0, width: 20, height: 20 },
      },
      styles: {},
      flags: { clipped: false, covered: false, offViewport: false },
    },
    runtime: { url: 'http://localhost/', route: '/' },
    timeline: [],
    environment: {
      ua: 'test-agent',
      viewport: [1024, 768],
      dpr: 1,
      locale: 'en-US',
      tz: 'UTC',
      colorScheme: 'light',
      reducedMotion: false,
    },
    intent: { comment: 'Broken', category: 'functional', annotations: [] },
    ...overrides,
  };
}

function noisyPayload(): Payload {
  const timeline: Timeline = Array.from({ length: 3000 }, (_, t) => ({
    t,
    kind: 'console',
    level: 'error',
    message: 'm'.repeat(100),
  }));

  return basePayload({
    element: {
      selectors: [{ kind: 'css', value: 'button' }],
      tag: 'button',
      attrs: {},
      text: 'Click',
      outerHTML: 'x'.repeat(100_000),
    },
    timeline,
  });
}

describe('payloadBytes', () => {
  it('measures UTF-8 bytes, not string length', () => {
    const payload = basePayload({
      intent: { comment: '日本語のコメント'.repeat(5), category: 'content', annotations: [] },
    });

    expect(payloadBytes(payload)).toBeGreaterThan(JSON.stringify(payload).length);
  });
});

describe('trimPayload', () => {
  it('returns a payload under the limit unchanged', () => {
    const payload = basePayload();

    const result = trimPayload(payload, 2048);

    expect(result.payload).toBe(payload);
    expect(result.trimmed).toEqual([]);
    expect(result.fits).toBe(true);
  });

  it('cuts outerHTML first and keeps the timeline when that is enough', () => {
    const timeline: Timeline = [{ t: 1, kind: 'navigation', from: '/a', to: '/b' }];
    const payload = basePayload({
      element: {
        selectors: [{ kind: 'css', value: 'div' }],
        tag: 'div',
        attrs: {},
        text: '',
        outerHTML: `<div>${'x'.repeat(2000)}</div>`,
      },
      timeline,
    });

    const result = trimPayload(payload, 900);

    expect(result.trimmed).toEqual(['outerHTML']);
    expect(result.fits).toBe(true);
    expect(result.payload.element.outerHTML.length).toBeLessThan(payload.element.outerHTML.length);
    expect(result.payload.timeline).toEqual(timeline);
  });

  it('keeps the longest outerHTML prefix that fits', () => {
    const maxBytes = 800;
    const payload = basePayload({
      element: {
        selectors: [{ kind: 'css', value: 'button' }],
        tag: 'button',
        attrs: {},
        text: 'Click',
        outerHTML: `<button>${'x'.repeat(1000)}</button>`,
      },
    });

    const result = trimPayload(payload, maxBytes);

    expect(payloadBytes(result.payload)).toBeLessThanOrEqual(maxBytes);

    const codePoints = Array.from(result.payload.element.outerHTML);
    const oneCodePointLonger = {
      ...result.payload,
      element: { ...result.payload.element, outerHTML: `${codePoints.join('')}x` },
    };
    expect(payloadBytes(oneCodePointLonger)).toBeGreaterThan(maxBytes);
  });

  it('drops the oldest timeline entries once outerHTML is empty', () => {
    const entries: Timeline = [
      { t: 5, kind: 'console', level: 'error', message: 'm'.repeat(20) },
      { t: 1, kind: 'console', level: 'error', message: 'm'.repeat(20) },
      { t: 3, kind: 'console', level: 'error', message: 'm'.repeat(20) },
      { t: 2, kind: 'console', level: 'error', message: 'm'.repeat(20) },
    ];
    const payload = basePayload({
      element: {
        selectors: [{ kind: 'css', value: 'div' }],
        tag: 'div',
        attrs: {},
        text: '',
        outerHTML: `<div>${'x'.repeat(5000)}</div>`,
      },
      timeline: entries,
    });
    const survivors = entries.filter((_entry, index) => index === 0 || index === 2);
    const maxBytes = payloadBytes({
      ...payload,
      element: { ...payload.element, outerHTML: '' },
      timeline: survivors,
    });

    const result = trimPayload(payload, maxBytes);

    expect(result.trimmed).toEqual(['outerHTML', 'timeline']);
    expect(result.payload.element.outerHTML).toBe('');
    expect(result.payload.timeline).toEqual(survivors);
    expect(result.fits).toBe(true);
  });

  it('reports fits false when the payload is still over after both cuts', () => {
    const payload = basePayload({
      intent: { comment: 'c'.repeat(5000), category: 'functional', annotations: [] },
    });

    const result = trimPayload(payload, 200);

    expect(result.fits).toBe(false);
  });

  it('never splits a surrogate pair in outerHTML', () => {
    const emoji = '😀';
    const payload = basePayload({
      element: {
        selectors: [{ kind: 'css', value: 'div' }],
        tag: 'div',
        attrs: {},
        text: '',
        outerHTML: `<div>${emoji.repeat(50)}</div>`,
      },
    });
    const skeletonBytes = payloadBytes({
      ...payload,
      element: { ...payload.element, outerHTML: '' },
    });

    const result = trimPayload(payload, skeletonBytes + 10);

    const unpaired = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(unpaired.test(result.payload.element.outerHTML)).toBe(false);
  });

  it('does not mutate its input', () => {
    const payload = basePayload({
      element: {
        selectors: [{ kind: 'css', value: 'div' }],
        tag: 'div',
        attrs: {},
        text: '',
        outerHTML: `<div>${'x'.repeat(2000)}</div>`,
      },
      timeline: [
        { t: 1, kind: 'navigation', from: '/a', to: '/b' },
        { t: 2, kind: 'navigation', from: '/b', to: '/c' },
      ],
    });
    const before = structuredClone(payload);

    trimPayload(payload, 300);

    expect(payload).toEqual(before);
  });

  it('a trimmed payload still parses against the schema', () => {
    const fixture = Payload.parse(
      JSON.parse(
        readFileSync(
          new URL('../../../fixtures/payloads/functional-failed-network.json', import.meta.url),
          'utf8',
        ),
      ),
    );
    const bulky: Payload = {
      ...fixture,
      element: { ...fixture.element, outerHTML: `<button>${'z'.repeat(4000)}</button>` },
    };

    const result = trimPayload(bulky, 2048);

    expect(() => Payload.parse(result.payload)).not.toThrow();
  });

  it('uses the 50 KB default when no maxBytes is given', () => {
    const payload = basePayload();

    const result = trimPayload(payload);

    expect(payloadBytes(payload)).toBeLessThanOrEqual(MARK_MAX_BYTES);
    expect(result.fits).toBe(true);
  });

  it('trims a 3000-entry timeline in at most 64 serializations', () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      const result = trimPayload(noisyPayload());

      expect(result.fits).toBe(true);
      expect(stringify.mock.calls.length).toBeLessThanOrEqual(64);
    } finally {
      stringify.mockRestore();
    }
  });

  it('keeps the most timeline entries that fit on a 3000-entry timeline', () => {
    const payload = noisyPayload();

    const result = trimPayload(payload);

    const kept = result.payload.timeline.length;
    expect(result.fits).toBe(true);
    expect(result.payload.timeline).toEqual(payload.timeline.slice(3000 - kept));

    const oneFewer = {
      ...result.payload,
      timeline: payload.timeline.slice(3000 - kept - 1),
    };
    expect(payloadBytes(oneFewer)).toBeGreaterThan(MARK_MAX_BYTES);
  });
});
