import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ChannelItems } from './index';

const SINCE = '2026-10-24T10:00:00Z';

function snapshot(agent?: unknown) {
  return agent === undefined ? { v: 1, items: [] } : { v: 1, items: [], agent };
}

describe('channel agent session', () => {
  it('keeps the agent session of a snapshot in each of its forms', () => {
    const forms = [
      { state: 'waiting', agent: 'claude', since: SINCE },
      { state: 'working', agent: 'claude', since: SINCE },
      { state: 'waiting', agent: 'claude', since: SINCE, background: true },
      { state: 'working', agent: 'claude', since: SINCE, background: true },
      { state: 'absent' },
    ];
    for (const agent of forms) {
      const input = snapshot(agent);
      const parsed = ChannelItems.parse(input);
      expect(parsed).toEqual(input);
      expect(ChannelItems.parse(parsed)).toEqual(parsed);
    }
    const extra = ChannelItems.parse(snapshot({ state: 'absent', note: 'x' }));
    expect(extra.agent).toEqual({ state: 'absent' });
  });

  it('parses a snapshot without an agent session as before', () => {
    const parsed = ChannelItems.parse(snapshot());
    expect(parsed).toEqual({ v: 1, items: [] });
    expect('agent' in parsed).toBe(false);
  });

  it('rejects an agent session that is neither form', () => {
    const ok = { state: 'working', agent: 'claude', since: SINCE };
    const bad: unknown[] = [
      { ...ok, state: 'sleeping' },
      { state: 'working', since: SINCE },
      { ...ok, agent: '' },
      { state: 'working', agent: 'claude' },
      { ...ok, since: 'not a date' },
      { ...ok, background: false },
      null,
      'working',
    ];
    for (const agent of bad) {
      expect(ChannelItems.safeParse({ v: 1, items: [], agent }).success).toBe(false);
    }
  });

  it('accepts any since that Date.parse reads and round-trips the snapshot', () => {
    fc.assert(
      fc.property(
        fc.date({ noInvalidDate: true }),
        fc.constantFrom('waiting', 'working'),
        (date, state) => {
          const input = snapshot({ state, agent: 'claude', since: date.toISOString() });
          const parsed = ChannelItems.parse(input);
          expect(parsed).toEqual(input);
          expect(ChannelItems.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
        },
      ),
      { numRuns: 25 },
    );
  });
});
