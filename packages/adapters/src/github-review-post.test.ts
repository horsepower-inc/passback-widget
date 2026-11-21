import { describe, expect, it } from 'vitest';
import type { InboxFile } from '@passback/inbox';
import { postPrReview, type GhRun } from './github-review-post';

type Reply = { code?: number; stdout?: string } | Error;
type Call = { args: string[]; stdin?: string };

const P = 'repos/o/r/pulls/7';
const PATCH = '@@ -1,2 +1,3 @@\n a\n+b\n c\n';

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

function fakeGh(routes: Record<string, Reply>) {
  const calls: Call[] = [];
  const run: GhRun = async (args, stdin) => {
    calls.push({ args, stdin });
    const key = args[0] === 'api' && args[1] === '-X' ? `POST ${args[3]}` : (args[1] ?? '');
    const reply = routes[key];
    if (reply === undefined) throw new Error(`no route for ${key}`);
    if (reply instanceof Error) throw reply;
    return { code: reply.code ?? 0, stdout: reply.stdout ?? '' };
  };
  return { run, calls };
}

const json = (v: unknown): Reply => ({ stdout: JSON.stringify(v) });

function routes(over: Record<string, Reply> = {}): Record<string, Reply> {
  return {
    [P]: json({ head: { sha: 'sha1' } }),
    [`${P}/files?per_page=100&page=1`]: json([{ filename: 'src/a.ts', patch: PATCH }]),
    [`${P}/comments?per_page=100&page=1`]: json([]),
    [`${P}/reviews?per_page=100&page=1`]: json([]),
    [`POST ${P}/reviews`]: { stdout: '{}' },
    ...over,
  };
}

const opts = { repo: 'o/r', pr: 7, marks: [mark({ id: 'm1', file: 'src/a.ts:2' })] };

describe('postPrReview', () => {
  it('reads the head sha, the files and the existing comments, then sends one review', async () => {
    const { run, calls } = fakeGh(routes());
    const r = await postPrReview(run, opts);
    expect(r).toMatchObject({ ok: true, posted: true, inline: ['m1'], unplaced: [] });
    expect(calls.map((c) => c.args[1])).toEqual([
      P,
      `${P}/files?per_page=100&page=1`,
      `${P}/comments?per_page=100&page=1`,
      `${P}/reviews?per_page=100&page=1`,
      '-X',
    ]);
    expect(calls.filter((c) => c.args.includes('POST'))).toHaveLength(1);
  });

  it('pages the files endpoint until a short page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}.ts` }));
    const { run, calls } = fakeGh(
      routes({
        [`${P}/files?per_page=100&page=1`]: json(full),
        [`${P}/files?per_page=100&page=2`]: json([{ filename: 'src/a.ts', patch: PATCH }]),
      }),
    );
    const r = await postPrReview(run, opts);
    expect(r).toMatchObject({ ok: true, inline: ['m1'] });
    const files = calls.filter((c) => c.args[1]?.includes('/files'));
    expect(files).toHaveLength(2);
  });

  it('moves a mark outside the diff into the review body', async () => {
    const { run } = fakeGh(routes());
    const r = await postPrReview(run, {
      ...opts,
      marks: [mark({ id: 'm1', file: 'src/a.ts:99' })],
    });
    expect(r).toMatchObject({ ok: true, posted: true, inline: [], unplaced: ['m1'] });
    if (r.ok) expect(r.review?.body).toContain('Not placed on the diff');
  });

  it('skips a mark already posted as a review comment or in a review body', async () => {
    const { run } = fakeGh(
      routes({
        [`${P}/comments?per_page=100&page=1`]: json([{ body: 'x\n<!-- passback:mark:m1 -->' }]),
        [`${P}/reviews?per_page=100&page=1`]: json([{ body: '- <!-- passback:mark:m2 -->' }]),
      }),
    );
    const r = await postPrReview(run, {
      ...opts,
      marks: [mark({ id: 'm1', file: 'src/a.ts:2' }), mark({ id: 'm2' }), mark({ id: 'm3' })],
    });
    expect(r).toMatchObject({ ok: true, posted: true, inline: [], unplaced: ['m3'] });
  });

  it('posts nothing when no open mark is left', async () => {
    const { run, calls } = fakeGh(routes());
    const r = await postPrReview(run, { ...opts, marks: [mark({ id: 'm1', status: 'verified' })] });
    expect(r).toEqual({ ok: true, posted: false, inline: [], unplaced: [] });
    expect(calls.some((c) => c.args.includes('POST'))).toBe(false);
  });

  it('dry run returns the review and runs no write', async () => {
    const { run, calls } = fakeGh(routes());
    const r = await postPrReview(run, { ...opts, dryRun: true });
    expect(r).toMatchObject({ ok: true, posted: false, inline: ['m1'] });
    if (r.ok) expect(r.review?.commit_id).toBe('sha1');
    expect(calls.some((c) => c.args.includes('POST'))).toBe(false);
  });

  it('sends the review JSON on stdin with commit_id, event COMMENT and the comments', async () => {
    const { run, calls } = fakeGh(routes());
    await postPrReview(run, opts);
    const post = calls.find((c) => c.args.includes('POST'));
    expect(post?.args).toEqual(['api', '-X', 'POST', `${P}/reviews`, '--input', '-']);
    const sent = JSON.parse(post?.stdin ?? '{}');
    expect(sent.commit_id).toBe('sha1');
    expect(sent.event).toBe('COMMENT');
    expect(sent.comments).toHaveLength(1);
    expect(sent.comments[0]).toMatchObject({ path: 'src/a.ts', line: 2, side: 'RIGHT' });
  });

  it('returns ok false when a read exits non-zero, without posting', async () => {
    const { run, calls } = fakeGh(
      routes({ [`${P}/comments?per_page=100&page=1`]: { code: 1, stdout: 'secret' } }),
    );
    const r = await postPrReview(run, opts);
    expect(r).toEqual({ ok: false, reason: 'gh exited 1 on comments' });
    expect(calls.some((c) => c.args.includes('POST'))).toBe(false);
  });

  it('returns ok false when the post exits non-zero', async () => {
    const { run } = fakeGh(routes({ [`POST ${P}/reviews`]: { code: 1, stdout: '422 stale' } }));
    const r = await postPrReview(run, opts);
    expect(r).toEqual({ ok: false, reason: 'gh exited 1 on post review' });
  });

  it('returns ok false when gh cannot run', async () => {
    const { run } = fakeGh(routes({ [P]: new Error('spawn gh ENOENT') }));
    const r = await postPrReview(run, opts);
    expect(r).toEqual({ ok: false, reason: 'gh could not run: spawn gh ENOENT' });
  });

  it('rejects a repo that is not owner/name and a pr that is not a positive integer before any gh call', async () => {
    const { run, calls } = fakeGh(routes());
    for (const bad of [{ repo: 'nope' }, { repo: 'o/r/x' }, { pr: 0 }, { pr: 1.5 }, { pr: -2 }]) {
      const r = await postPrReview(run, { ...opts, ...bad });
      expect(r.ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });
});
