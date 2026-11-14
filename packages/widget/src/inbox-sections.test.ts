import { describe, expect, it } from 'vitest';
import { countsOf, filedLine, sectionOf, stateLine, type InboxRowView } from './inbox-sections';

const row = (over: Partial<InboxRowView> = {}): InboxRowView => ({
  id: 'a',
  status: 'new',
  iteration: 1,
  comment: 'c',
  createdAt: '2026-10-24T00:00:00Z',
  route: '/',
  iterations: [{ n: 1 }],
  ...over,
});
const failed = (message?: string) => ({
  iterations: [{ n: 1, statuses: [{ state: 'failed', message, at: 't' }] }],
});

describe('inbox sections', () => {
  it('puts a withdrawn row in no section', () => {
    expect(sectionOf(row({ status: 'withdrawn' }))).toBeUndefined();
    expect(sectionOf(row({ status: 'withdrawn', parked: true }))).toBeUndefined();
  });

  it('puts a parked row in Tracker before its status is read', () => {
    expect(sectionOf(row({ parked: true, status: 'verified' }))).toBe('tracker');
    expect(sectionOf(row({ parked: true, status: 'declined' }))).toBe('tracker');
  });

  it('puts proposed, verified and accepted rows in Fixed', () => {
    for (const status of ['proposed', 'verified', 'accepted'])
      expect(sectionOf(row({ status }))).toBe('fixed');
  });

  it('puts a declined row or a row whose last status failed in Needs you', () => {
    expect(sectionOf(row({ status: 'declined' }))).toBe('needs');
    expect(sectionOf(row({ status: 'ack', ...failed() }))).toBe('needs');
    const recovered = row({
      iterations: [
        {
          n: 1,
          statuses: [
            { state: 'failed', at: 't' },
            { state: 'running', at: 'u' },
          ],
        },
      ],
    });
    expect(sectionOf(recovered)).toBe('working');
    const malformed = [[null], [{ n: 1, statuses: null }], [{ n: 1, statuses: [null] }]];
    for (const iterations of malformed) {
      const broken = row({ iterations } as unknown as Partial<InboxRowView>);
      expect(sectionOf(broken)).toBe('working');
      expect(stateLine(broken)).toBe('Waiting for the agent');
    }
  });

  it('puts a row whose last status is a question in Needs you', () => {
    const asking = row({
      status: 'ack',
      iterations: [{ n: 1, statuses: [{ state: 'question', message: 'Which color?', at: 't' }] }],
    });
    expect(sectionOf(asking)).toBe('needs');
    expect(stateLine(asking)).toBe('The agent asks: Which color?');
  });

  it('moves the row on when running follows the question', () => {
    const moved = row({
      status: 'ack',
      iterations: [
        {
          n: 1,
          statuses: [
            { state: 'question', message: 'Which color?', at: 't' },
            { state: 'running', at: 'u' },
          ],
        },
      ],
    });
    expect(sectionOf(moved)).toBe('working');
    expect(stateLine(moved)).toBe('The agent is working');
  });

  it('puts new and ack rows in Working', () => {
    expect(sectionOf(row())).toBe('working');
    expect(sectionOf(row({ status: 'ack' }))).toBe('working');
  });

  it('counts each section and the sum for All, and leaves Tracker out without a site', () => {
    const rows = [
      row({ status: 'declined' }),
      row({ status: 'ack' }),
      row({ status: 'new' }),
      row({ status: 'proposed' }),
      row({ parked: true }),
      row({ status: 'withdrawn' }),
    ];
    expect(countsOf(rows, 2, true)).toEqual({
      all: 7,
      needs: 1,
      send: 2,
      working: 2,
      fixed: 1,
      tracker: 1,
    });
    expect(countsOf(rows, 2, false)).toMatchObject({ all: 6, tracker: 0 });
  });

  it('gives one state line for each section', () => {
    expect(stateLine(row({ status: 'ack', ...failed('Build broke') }))).toBe('Build broke');
    expect(stateLine(row({ status: 'ack', ...failed() }))).toBe('Failed');
    expect(stateLine(row({ status: 'declined' }))).toBe('The agent declined this comment');
    expect(stateLine(row())).toBe('Waiting for the agent');
    expect(stateLine(row({ status: 'ack' }))).toBe('The agent is working');
    expect(stateLine(row({ status: 'proposed' }))).toBe('Fixed');
    expect(stateLine(row({ status: 'verified' }))).toBe('Fixed');
    expect(stateLine(row({ status: 'accepted' }))).toBe('Accepted');
    expect(stateLine(row({ parked: true }))).toBe('Parked for the tracker');
    expect(stateLine()).toBe('Not sent yet');
  });

  it('counts the filed comments in Tracker and in All only when the tracker is shown', () => {
    const rows = [row({ parked: true }), row({ id: 'b' })];
    expect(countsOf(rows, 0, true, 2)).toMatchObject({ all: 4, working: 1, tracker: 3 });
    expect(countsOf(rows, 0, false, 2)).toMatchObject({ all: 1, tracker: 0 });
    expect(countsOf(rows, 0, true)).toMatchObject({ all: 2, tracker: 1 });
  });

  it('writes the filed line with the tracker name, or without one', () => {
    expect(filedLine('Linear', 'ISSUE-7')).toBe('Filed in Linear · ISSUE-7');
    expect(filedLine(undefined, 'ISSUE-7')).toBe('Filed in the tracker · ISSUE-7');
  });
});
