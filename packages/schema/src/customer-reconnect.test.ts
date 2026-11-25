import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CustomerError, CustomerErrorCode, IntegrationView } from './customer';

const view = {
  tracker: 'linear',
  project: 'Web',
  account: 'acme',
  verifiedAt: '2026-10-19T00:00:00Z',
  credential: 'set',
};

describe('reconnectSince', () => {
  it('an integration view parses with and without reconnectSince', () => {
    expect(IntegrationView.safeParse(view).success).toBe(true);
    const marked = IntegrationView.parse({ ...view, reconnectSince: '2026-11-01T10:00:00Z' });
    expect(marked.reconnectSince).toBe('2026-11-01T10:00:00Z');
    expect(IntegrationView.safeParse({ ...view, unknownKey: 1 }).success).toBe(false);
  });

  it('any ISO time is accepted as reconnectSince and any other string is refused', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('1970-01-01T00:00:00Z'),
          max: new Date('2999-12-31T23:59:59Z'),
          noInvalidDate: true,
        }),
        (d) => {
          expect(
            IntegrationView.safeParse({ ...view, reconnectSince: d.toISOString() }).success,
          ).toBe(true);
        },
      ),
    );
    fc.assert(
      fc.property(
        fc.string().filter((s) => !z_isIso(s)),
        (s) => {
          expect(IntegrationView.safeParse({ ...view, reconnectSince: s }).success).toBe(false);
        },
      ),
    );
  });

  it('reconnect_needed is a customer error code', () => {
    expect(CustomerErrorCode.safeParse('reconnect_needed').success).toBe(true);
    expect(CustomerError.parse({ code: 'reconnect_needed' })).toEqual({ code: 'reconnect_needed' });
  });
});

// a string counts as ISO time when the schema's own date-time check would take it: ISO shape and a real date
function z_isIso(s: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s) &&
    !Number.isNaN(Date.parse(s))
  );
}
