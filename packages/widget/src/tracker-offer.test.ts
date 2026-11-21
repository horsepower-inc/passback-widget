// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { trackerOffer } from './tracker-offer';

type Scope = { __passback?: Record<string, unknown> };

function setRelay(relay: unknown): void {
  (window as unknown as Scope).__passback = { relay };
}

afterEach(() => {
  delete (window as unknown as Scope).__passback;
});

describe('trackerOffer', () => {
  it('returns the tracker name when the subscription is active and a tracker is named', () => {
    setRelay(() => ({ subscription: 'active', tracker: 'linear' }));
    expect(trackerOffer(window)).toBe('linear');
  });

  it('returns undefined for a none subscription, no tracker or an empty one', () => {
    const bodies = [
      { subscription: 'none', tracker: 'linear' },
      { subscription: 'none', tracker: null },
      { subscription: 'active', tracker: null },
      { subscription: 'active', tracker: '' },
      { subscription: 'active', tracker: 7 },
      { subscription: 'active' },
    ];
    for (const body of bodies) {
      setRelay(() => body);
      expect(trackerOffer(window)).toBeUndefined();
    }
  });

  it('returns undefined when the getter is missing, throws or answers something that is not an object', () => {
    expect(trackerOffer(window)).toBeUndefined();
    (window as unknown as Scope).__passback = {};
    expect(trackerOffer(window)).toBeUndefined();
    setRelay('active');
    expect(trackerOffer(window)).toBeUndefined();
    setRelay(() => {
      throw new Error('boom');
    });
    expect(trackerOffer(window)).toBeUndefined();
    for (const body of [null, 'active', 3, undefined]) {
      setRelay(() => body);
      expect(trackerOffer(window)).toBeUndefined();
    }
  });
});
