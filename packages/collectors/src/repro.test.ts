import type { TimelineEvent } from '@passback/schema';
import { describe, expect, it } from 'vitest';
import { MAX_REPRO_STEPS, buildRepro } from './repro';

const URL = 'https://example.test/page';

describe('buildRepro', () => {
  it('starts with a goto of the mark url', () => {
    const repro = buildRepro({
      url: URL,
      timeline: [{ t: 0, kind: 'action', type: 'click', selector: '#btn' }],
    });

    expect(repro.steps[0]).toEqual({ op: 'goto', target: URL });
  });

  it('starts from the from-url of the first navigation when the timeline navigated', () => {
    const repro = buildRepro({
      url: URL,
      timeline: [{ t: 0, kind: 'navigation', from: 'https://example.test/start', to: URL }],
    });

    expect(repro.steps[0]).toEqual({ op: 'goto', target: 'https://example.test/start' });
  });

  it('turns a click with a selector into a click step', () => {
    const repro = buildRepro({
      url: URL,
      timeline: [{ t: 0, kind: 'action', type: 'click', selector: '[data-testid="submit"]' }],
    });

    expect(repro.steps).toEqual([
      { op: 'goto', target: URL },
      { op: 'click', target: '[data-testid="submit"]' },
    ]);
  });

  it('drops clicks without a selector, inputs, scrolls, console and network events', () => {
    const timeline: TimelineEvent[] = [
      { t: 0, kind: 'action', type: 'click' },
      { t: 100, kind: 'action', type: 'input', selector: '#name' },
      { t: 200, kind: 'action', type: 'scroll', delta: [0, 100] },
      { t: 300, kind: 'console', level: 'error', message: 'oops' },
      { t: 400, kind: 'network', url: 'https://api.test/x', method: 'GET', status: 200, ms: 12 },
      { t: 500, kind: 'rejection', message: 'boom' },
    ];

    const repro = buildRepro({ url: URL, timeline });

    expect(repro.steps).toEqual([{ op: 'goto', target: URL }]);
  });

  it('turns a navigation into a goto of its destination', () => {
    const repro = buildRepro({
      url: URL,
      timeline: [
        {
          t: 0,
          kind: 'navigation',
          from: 'https://example.test/start',
          to: 'https://example.test/next',
        },
      ],
    });

    expect(repro.steps).toEqual([
      { op: 'goto', target: 'https://example.test/start' },
      { op: 'goto', target: 'https://example.test/next' },
    ]);
  });

  it('inserts a wait for a gap of a second or more, capped at five seconds', () => {
    const withinRange = buildRepro({
      url: URL,
      timeline: [
        { t: 0, kind: 'action', type: 'click', selector: '#a' },
        { t: 1500, kind: 'action', type: 'click', selector: '#b' },
      ],
    });

    expect(withinRange.steps).toEqual([
      { op: 'goto', target: URL },
      { op: 'click', target: '#a' },
      { op: 'wait', target: '1500' },
      { op: 'click', target: '#b' },
    ]);

    const overCap = buildRepro({
      url: URL,
      timeline: [
        { t: 0, kind: 'action', type: 'click', selector: '#a' },
        { t: 9000, kind: 'action', type: 'click', selector: '#b' },
      ],
    });

    expect(overCap.steps).toEqual([
      { op: 'goto', target: URL },
      { op: 'click', target: '#a' },
      { op: 'wait', target: '5000' },
      { op: 'click', target: '#b' },
    ]);
  });

  it('adds no wait for a shorter gap', () => {
    const repro = buildRepro({
      url: URL,
      timeline: [
        { t: 0, kind: 'action', type: 'click', selector: '#a' },
        { t: 500, kind: 'action', type: 'click', selector: '#b' },
      ],
    });

    expect(repro.steps).toEqual([
      { op: 'goto', target: URL },
      { op: 'click', target: '#a' },
      { op: 'click', target: '#b' },
    ]);
  });

  it('orders steps by time', () => {
    const repro = buildRepro({
      url: URL,
      timeline: [
        { t: 500, kind: 'action', type: 'click', selector: '#b' },
        { t: 0, kind: 'action', type: 'click', selector: '#a' },
      ],
    });

    expect(repro.steps).toEqual([
      { op: 'goto', target: URL },
      { op: 'click', target: '#a' },
      { op: 'click', target: '#b' },
    ]);
  });

  it('keeps the first goto and the last nineteen steps of a longer trace', () => {
    const timeline: TimelineEvent[] = Array.from({ length: 25 }, (_, i) => ({
      t: i * 100,
      kind: 'action',
      type: 'click',
      selector: `#item-${i}`,
    }));

    const repro = buildRepro({ url: URL, timeline });

    expect(repro.steps).toHaveLength(MAX_REPRO_STEPS);
    expect(repro.steps[0]).toEqual({ op: 'goto', target: URL });
    expect(repro.steps[1]).toEqual({ op: 'click', target: '#item-6' });
    expect(repro.steps[repro.steps.length - 1]).toEqual({ op: 'click', target: '#item-24' });
  });
});
