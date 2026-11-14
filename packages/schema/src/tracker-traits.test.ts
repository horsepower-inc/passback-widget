import { describe, expect, it } from 'vitest';
import { CUSTOMER_TRACKERS, UpdateIntegration } from './index';
import { TRACKER_TRAITS, type TrackerTraits } from './tracker-traits';

const rows: Record<string, TrackerTraits> = TRACKER_TRAITS;

describe('TRACKER_TRAITS', () => {
  it('every customer tracker has one traits row and no other row', () => {
    expect(Object.keys(TRACKER_TRAITS).sort()).toEqual([...CUSTOMER_TRACKERS].sort());
  });

  it('the editable rows are exactly the trackers UpdateIntegration has a variant for', () => {
    const variants = UpdateIntegration.options.map((o) => o.shape.tracker.value as string);
    const editable = Object.keys(rows).filter((t) => rows[t]?.editable);
    expect(editable.sort()).toEqual([...variants].sort());
  });

  it('a parent key is a field of that tracker update body and only nested-only trackers have one', () => {
    for (const option of UpdateIntegration.options) {
      const tracker: string = option.shape.tracker.value;
      const row = rows[tracker];
      if (!row) throw new Error(`no traits row for ${tracker}`);
      if (row.parent !== null) expect(Object.keys(option.shape), tracker).toContain(row.parent);
      expect(row.parent !== null, tracker).toBe(row.targets === 'nested-only');
    }
  });
});
