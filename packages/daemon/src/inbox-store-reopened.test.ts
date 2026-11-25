import { describe, expect, it } from 'vitest';
import type { InboxFile, Verdict } from '@passback/inbox';
import { reopenedFeedback } from './inbox-store';

function reopened(verdict: Verdict, overrides: Partial<InboxFile> = {}): InboxFile {
  return {
    id: 'm1',
    schemaVersion: 1,
    batchId: 'm1',
    status: 'ack',
    iteration: 2,
    route: '/',
    selector: '[data-testid=price]',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [
      {
        n: 1,
        agent: { at: '2026-09-19T14:05:00Z', text: 'fixed' },
        human: { at: '2026-09-19T14:10:00Z', verdict },
      },
    ],
    ...overrides,
  };
}

describe('reopenedFeedback', () => {
  it('reopenedFeedback gives the comment of the verdict on the previous iteration', () => {
    const file = reopened({ kind: 'comment', text: 'still too small' });
    expect(reopenedFeedback(file)).toEqual({ iteration: 2, comment: 'still too small' });
  });

  it('reopenedFeedback gives the reason of a decline', () => {
    const file = reopened({ kind: 'decline', reason: 'wrong element' });
    expect(reopenedFeedback(file)).toEqual({ iteration: 2, comment: 'wrong element' });
  });

  it('reopenedFeedback is undefined for a first-iteration mark the agent is working on', () => {
    const file = reopened({ kind: 'accept' }, { iteration: 1, iterations: [] });
    expect(reopenedFeedback(file)).toBeUndefined();
    expect(reopenedFeedback(reopened({ kind: 'accept' }))).toBeUndefined();
  });

  it('reopenedFeedback is undefined once the agent has replied on the current iteration', () => {
    const base = reopened({ kind: 'comment', text: 'still too small' });
    const file = {
      ...base,
      status: 'proposed' as const,
      iterations: [
        ...base.iterations,
        { n: 2, agent: { at: '2026-09-19T14:20:00Z', text: 'again' } },
      ],
    };
    expect(reopenedFeedback(file)).toBeUndefined();
    expect(reopenedFeedback({ ...file, status: 'ack' })).toBeUndefined();
  });
});
