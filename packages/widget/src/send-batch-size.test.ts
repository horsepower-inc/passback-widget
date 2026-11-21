import { describe, expect, it, vi } from 'vitest';
import type { ChannelAck, ChannelMark, Payload } from '@passback/schema';
import { TOO_LARGE, sendMarks } from './send';

const LIMIT = 65_536;

function basePayload(comment = 'Broken'): Payload {
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
    intent: { comment, category: 'functional', annotations: [] },
  };
}

function withHtml(size: number, comment = 'Broken'): Payload {
  const p = basePayload(comment);
  p.element.outerHTML = 'x'.repeat(size);
  return p;
}

function recorder() {
  const bodies: string[] = [];
  const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = String(init?.body);
    bodies.push(body);
    const mark = JSON.parse(body) as ChannelMark;
    const ack: ChannelAck = {
      v: 1,
      batchId: mark.batch?.id ?? '',
      accepted: (mark.batch?.marks ?? []).map((_m, i) => `id${i}`),
      trimmed: [],
    };
    return new Response(JSON.stringify(ack), { status: 202 });
  }) as unknown as typeof fetch;
  return { bodies, fetchFn };
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('send batch size', () => {
  it('sends two large marks in one request under the relay limit', async () => {
    const { bodies, fetchFn } = recorder();
    const r = await sendMarks({
      payloads: [withHtml(40_000, 'a'), withHtml(45_000, 'b')],
      endpoint: 'http://relay.example/mark',
      fetchFn,
    });
    expect(r.ok).toBe(true);
    expect(bodies).toHaveLength(1);
    expect(bytes(bodies[0] ?? '')).toBeLessThanOrEqual(LIMIT);
    // Trimming the larger mark alone makes the request fit, so the smaller one stays whole.
    expect(r.ok && r.trimmed).toEqual([false, true]);
    const sent = (JSON.parse(bodies[0] ?? '') as ChannelMark).batch?.marks;
    expect(sent?.[0]?.element.outerHTML).toHaveLength(40_000);
  });

  it('trims the mark that can shrink when the largest cannot', async () => {
    const { bodies, fetchFn } = recorder();
    const fixed = (size: number, c: string) => {
      const p = withHtml(0, c);
      p.element.attrs = { a: 'y'.repeat(size) };
      return p;
    };
    const r = await sendMarks({
      payloads: [fixed(12_000, 'a'), withHtml(24_000, 'b'), fixed(30_000, 'c')],
      endpoint: 'http://relay.example/mark',
      fetchFn,
    });
    // The largest mark has nothing to remove: it is neither reported nor a reason to refuse.
    expect(r.ok && r.trimmed).toEqual([false, true, false]);
    expect(bytes(bodies[0] ?? '')).toBeLessThanOrEqual(LIMIT);
  });

  it('leaves a batch that already fits untouched', async () => {
    const { bodies, fetchFn } = recorder();
    // The body lands within a few hundred bytes of the limit: it fits, so nothing is trimmed.
    const payloads = [withHtml(32_000, 'a'), withHtml(32_000, 'b')];
    const r = await sendMarks({ payloads, endpoint: 'http://relay.example/mark', fetchFn });
    expect(r.ok && r.trimmed).toEqual([false, false]);
    expect(bytes(bodies[0] ?? '')).toBeGreaterThan(LIMIT - 1024);
    expect(bytes(bodies[0] ?? '')).toBeLessThanOrEqual(LIMIT);
    const sent = (JSON.parse(bodies[0] ?? '') as ChannelMark).batch?.marks;
    expect(sent).toEqual(payloads);
  });

  it('refuses only a batch that cannot fit after trimming', async () => {
    const { bodies, fetchFn } = recorder();
    // Twenty marks whose fixed part alone is 4 KB each cannot fit, however far outerHTML is trimmed.
    const heavy = (c: string) => {
      const p = withHtml(10, c);
      p.element.attrs = { a: 'y'.repeat(4000) };
      return p;
    };
    const r = await sendMarks({
      payloads: Array.from({ length: 20 }, (_, i) => heavy(`m${i}`)),
      endpoint: 'http://relay.example/mark',
      fetchFn,
    });
    expect(r).toEqual({ ok: false, reason: 'rejected', message: TOO_LARGE });
    expect(bodies).toHaveLength(0);
  });
});
