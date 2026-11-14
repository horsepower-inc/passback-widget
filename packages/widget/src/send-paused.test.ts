// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { ChannelMark, Payload } from '@passback/schema';
import { sendMark } from './send';

function minimalPayload(): Payload {
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
  };
}

describe('sendMark on a paused site', () => {
  it('says the site is paused for a 402', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'account_paused' }), { status: 402 }));

    const result = await sendMark({
      payload: minimalPayload(),
      endpoint: 'http://localhost/mark',
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      newId: () => '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    });

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const posted = JSON.parse(init.body as string) as ChannelMark;
    expect(posted.batch.marks).toHaveLength(1);
    expect(result).toEqual({ ok: false, reason: 'rejected', message: 'this site is paused.' });
  });
});
