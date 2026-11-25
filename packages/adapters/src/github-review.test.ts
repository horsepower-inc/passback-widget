import { describe, expect, it } from 'vitest';
import type { InboxFile } from '@passback/inbox';
import { renderPrReview } from './github-review';

function mark(over: Partial<InboxFile> & { id: string }): InboxFile {
  return {
    schemaVersion: 1,
    batchId: 'b1',
    status: 'new',
    iteration: 1,
    route: '/home',
    selector: '#cta',
    createdAt: '2026-09-30T00:00:00Z',
    comment: 'Button is clipped',
    annotations: [],
    iterations: [],
    ...over,
  };
}

const any = { commitId: 'abc123', isCommentable: () => true };

describe('renderPrReview', () => {
  it('places a mark with file and line inline', () => {
    const r = renderPrReview([mark({ id: 'm1', file: 'src/a.tsx:12' })], any);
    expect(r?.inline).toEqual(['m1']);
    expect(r?.unplaced).toEqual([]);
    expect(r?.review.commit_id).toBe('abc123');
    expect(r?.review.event).toBe('COMMENT');
    expect(r?.review.comments).toEqual([
      {
        path: 'src/a.tsx',
        line: 12,
        side: 'RIGHT',
        body: 'Button is clipped\n\npassback mark m1 · route /home · selector #cta\n<!-- passback:mark:m1 -->',
      },
    ]);
    expect(r?.review.body).toBe('passback: open marks 1 (1 inline, 0 in this list)');
  });

  it('leaves the selector out of an inline comment when the mark has none', () => {
    const r = renderPrReview([mark({ id: 'm1', file: 'src/a.tsx:12', selector: '' })], any);
    expect(r?.review.comments[0]?.body).toBe(
      'Button is clipped\n\npassback mark m1 · route /home\n<!-- passback:mark:m1 -->',
    );
  });

  it('reads file:line and file:line:col', () => {
    const r = renderPrReview(
      [mark({ id: 'm1', file: 'a.ts:3' }), mark({ id: 'm2', file: 'b.ts:4:9' })],
      any,
    );
    expect(r?.review.comments.map((c) => [c.path, c.line])).toEqual([
      ['a.ts', 3],
      ['b.ts', 4],
    ]);
  });

  it('puts a mark whose line is not on the diff in the review body', () => {
    const r = renderPrReview([mark({ id: 'm1', file: 'a.ts:3' })], {
      ...any,
      isCommentable: () => false,
    });
    expect(r?.inline).toEqual([]);
    expect(r?.unplaced).toEqual(['m1']);
    expect(r?.review.comments).toEqual([]);
    expect(r?.review.body).toBe(
      [
        'passback: open marks 1 (0 inline, 1 in this list)',
        '',
        '### Not placed on the diff',
        '- `m1` `/home`: Button is clipped (a.ts:3) <!-- passback:mark:m1 -->',
      ].join('\n'),
    );
  });

  it('puts a mark with no source location in the review body', () => {
    const r = renderPrReview(
      [mark({ id: 'm1' }), mark({ id: 'm2', file: 'deadbeef', comment: 'First\nsecond' })],
      any,
    );
    expect(r?.unplaced).toEqual(['m1', 'm2']);
    expect(r?.review.body).toContain(
      '- `m1` `/home`: Button is clipped (no source location) <!-- passback:mark:m1 -->',
    );
    expect(r?.review.body).toContain('- `m2` `/home`: First (deadbeef) <!-- passback:mark:m2 -->');
  });

  it('skips marks that are not open', () => {
    const closed = ['verified', 'accepted', 'declined', 'withdrawn'] as const;
    const marks = closed.map((status, i) => mark({ id: `c${i}`, status, file: 'a.ts:1' }));
    const open = mark({ id: 'o1', status: 'ack', orphaned: true, file: 'a.ts:1' });
    const r = renderPrReview([...marks, open], any);
    expect(r?.inline).toEqual(['o1']);
  });

  it('skips marks already posted', () => {
    const r = renderPrReview([mark({ id: 'm1', file: 'a.ts:1' }), mark({ id: 'm2' })], {
      ...any,
      alreadyPosted: new Set(['m1']),
    });
    expect(r?.inline).toEqual([]);
    expect(r?.unplaced).toEqual(['m2']);
  });

  it('returns undefined when nothing is left to post', () => {
    expect(renderPrReview([], any)).toBeUndefined();
    expect(renderPrReview([mark({ id: 'm1', status: 'accepted' })], any)).toBeUndefined();
    expect(
      renderPrReview([mark({ id: 'm1' })], { ...any, alreadyPosted: new Set(['m1']) }),
    ).toBeUndefined();
  });

  it('sorts by mark id and puts the marker in every comment and body line', () => {
    const r = renderPrReview(
      [
        mark({ id: 'b', file: 'x.ts:2' }),
        mark({ id: 'd' }),
        mark({ id: 'a', file: 'x.ts:1' }),
        mark({ id: 'c' }),
      ],
      any,
    );
    expect(r?.inline).toEqual(['a', 'b']);
    expect(r?.unplaced).toEqual(['c', 'd']);
    for (const c of r?.review.comments ?? []) {
      const id = c.line === 1 ? 'a' : 'b';
      expect(c.body.endsWith(`<!-- passback:mark:${id} -->`)).toBe(true);
    }
    const markLines = (r?.review.body ?? '').split(/\n/).filter((l) => l.startsWith('- '));
    expect(markLines).toHaveLength(2);
    expect(markLines[0]).toContain('<!-- passback:mark:c -->');
    expect(markLines[1]).toContain('<!-- passback:mark:d -->');
  });
});
