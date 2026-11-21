import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InboxFile, Verdict } from '@passback/inbox';
import { toMarkView } from './mark-view';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'pb-view-reopened-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function file(overrides: Partial<InboxFile> = {}): InboxFile {
  return {
    id: 'm1',
    schemaVersion: 1,
    batchId: 'm1',
    status: 'new',
    iteration: 1,
    route: '/',
    selector: '[data-testid=price]',
    createdAt: '2026-09-19T14:00:00Z',
    comment: 'looks off',
    annotations: [],
    iterations: [],
    ...overrides,
  };
}

function reopened(verdict: Verdict): InboxFile {
  return file({
    status: 'ack',
    iteration: 2,
    iterations: [
      {
        n: 1,
        agent: { at: '2026-09-19T14:05:00Z', text: 'fixed' },
        human: { at: '2026-09-19T14:10:00Z', verdict },
      },
    ],
  });
}

describe('toMarkView reopened', () => {
  it('carries the iteration and the reporter comment of a reopened mark', async () => {
    const view = await toMarkView(dir, reopened({ kind: 'comment', text: 'still too small' }));
    expect(view.reopened).toEqual({ iteration: 2, comment: 'still too small' });
  });

  it('carries the reason of a decline as the comment', async () => {
    const view = await toMarkView(dir, reopened({ kind: 'decline', reason: 'wrong element' }));
    expect(view.reopened).toEqual({ iteration: 2, comment: 'wrong element' });
  });

  it('leaves the field out of a new mark', async () => {
    const view = await toMarkView(dir, file());
    expect('reopened' in view).toBe(false);
  });
});
