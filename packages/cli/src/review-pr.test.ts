import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GhRun } from '@passback/adapters/local';
import { render, type InboxFile } from '@passback/inbox';
import { runReviewPr } from './review-pr';

const P = 'repos/o/r/pulls/7';
const PATCH = '@@ -1,2 +1,3 @@\n a\n+b\n c\n';

let tmpDir: string | undefined;

afterEach(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

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

async function makeRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'passback-review-pr-'));
  tmpDir = root;
  const inbox = path.join(root, '.passback', 'inbox');
  await mkdir(inbox, { recursive: true });
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(inbox, name), text);
  return root;
}

function fakeGh(over: Record<string, { code?: number; stdout?: string } | Error> = {}) {
  const calls: { args: string[]; stdin?: string }[] = [];
  const routes: Record<string, { code?: number; stdout?: string } | Error> = {
    'repo view': { stdout: 'o/r\n' },
    [P]: { stdout: JSON.stringify({ head: { sha: 'sha1' } }) },
    [`${P}/files?per_page=100&page=1`]: {
      stdout: JSON.stringify([{ filename: 'src/a.ts', patch: PATCH }]),
    },
    [`${P}/comments?per_page=100&page=1`]: { stdout: '[]' },
    [`${P}/reviews?per_page=100&page=1`]: { stdout: '[]' },
    [`POST ${P}/reviews`]: { stdout: '{}' },
    ...over,
  };
  const run: GhRun = async (args, stdin) => {
    calls.push({ args, stdin });
    const key =
      args[0] === 'repo' ? 'repo view' : args[1] === '-X' ? `POST ${args[3]}` : (args[1] ?? '');
    const reply = routes[key];
    if (reply === undefined) throw new Error(`no route for ${key}`);
    if (reply instanceof Error) throw reply;
    return { code: reply.code ?? 0, stdout: reply.stdout ?? '' };
  };
  return { run, calls };
}

function makeIo() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err };
}

const m1 = () => render(mark({ id: 'm1', file: 'src/a.ts:2' }));

describe('runReviewPr', () => {
  it('posts the open marks of the inbox as one review', async () => {
    const root = await makeRoot({
      'm1.md': m1(),
      'm2.md': render(mark({ id: 'm2' })),
      'm3.md': render(mark({ id: 'm3', status: 'verified' })),
    });
    const { run, calls } = fakeGh();
    const { io, out, err } = makeIo();
    const code = await runReviewPr({ root, pr: 7, repo: 'o/r', dryRun: false }, { run }, io);
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out).toEqual(['posted review on o/r#7: 1 inline, 1 in the review body']);
    const posts = calls.filter((c) => c.args.includes('POST'));
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]!.stdin!).comments).toHaveLength(1);
  });

  it('prints the review and posts nothing with dryRun', async () => {
    const root = await makeRoot({ 'm1.md': m1() });
    const { run, calls } = fakeGh();
    const { io, out } = makeIo();
    const code = await runReviewPr({ root, pr: 7, repo: 'o/r', dryRun: true }, { run }, io);
    expect(code).toBe(0);
    expect(calls.some((c) => c.args.includes('POST'))).toBe(false);
    expect(JSON.parse(out.join('\n'))).toMatchObject({ commit_id: 'sha1', event: 'COMMENT' });
  });

  it('asks gh for the repository when none is given', async () => {
    const root = await makeRoot({ 'm1.md': m1() });
    const { run, calls } = fakeGh();
    const { io, out } = makeIo();
    const code = await runReviewPr({ root, pr: 7, dryRun: false }, { run }, io);
    expect(code).toBe(0);
    expect(calls[0]!.args).toEqual([
      'repo',
      'view',
      '--json',
      'nameWithOwner',
      '--jq',
      '.nameWithOwner',
    ]);
    expect(out[0]).toContain('o/r#7');
  });

  it('says gh is needed when it cannot be started and no repo is given', async () => {
    const root = await makeRoot({ 'm1.md': m1() });
    const { run, calls } = fakeGh({ 'repo view': new Error('spawn gh ENOENT') });
    const { io, out, err } = makeIo();
    const code = await runReviewPr({ root, pr: 7, dryRun: false }, { run }, io);
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual([
      'passback review-pr needs the GitHub CLI: install gh and run gh auth login',
    ]);
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => c.args.includes('POST'))).toBe(false);
  });

  it('adds the gh hint when gh cannot be started with --repo given', async () => {
    const root = await makeRoot({ 'm1.md': m1() });
    const { run, calls } = fakeGh({ [P]: new Error('spawn gh ENOENT') });
    const { io, out, err } = makeIo();
    const code = await runReviewPr({ root, pr: 7, repo: 'o/r', dryRun: false }, { run }, io);
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual([
      'passback review-pr: gh could not run: spawn gh ENOENT',
      'passback review-pr needs the GitHub CLI: install gh and run gh auth login',
    ]);
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => c.args.includes('POST'))).toBe(false);
  });

  it('reports no open marks and exits 0', async () => {
    const root = await makeRoot({ 'm1.md': render(mark({ id: 'm1', status: 'verified' })) });
    const { run, calls } = fakeGh();
    const { io, out } = makeIo();
    const code = await runReviewPr({ root, pr: 7, repo: 'o/r', dryRun: false }, { run }, io);
    expect(code).toBe(0);
    expect(out).toEqual(['no open marks to post']);
    expect(calls.some((c) => c.args.includes('POST'))).toBe(false);
  });

  it('skips an unparseable inbox file and says so', async () => {
    const root = await makeRoot({ 'bad.md': 'not an inbox file', 'm1.md': m1() });
    const { run } = fakeGh();
    const { io, out, err } = makeIo();
    const code = await runReviewPr({ root, pr: 7, repo: 'o/r', dryRun: false }, { run }, io);
    expect(code).toBe(0);
    expect(err).toEqual(['skipped bad.md: inbox file missing frontmatter']);
    expect(out).toEqual(['posted review on o/r#7: 1 inline, 0 in the review body']);
  });

  it('exits 1 with the reason when the post fails', async () => {
    const root = await makeRoot({ 'm1.md': m1() });
    const { run } = fakeGh({ [`POST ${P}/reviews`]: { code: 1 } });
    const { io, out, err } = makeIo();
    const code = await runReviewPr({ root, pr: 7, repo: 'o/r', dryRun: false }, { run }, io);
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual(['passback review-pr: gh exited 1 on post review']);
  });

  it('exits 1 when the inbox directory is missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'passback-review-pr-'));
    tmpDir = root;
    const { run } = fakeGh();
    const { io, err } = makeIo();
    const code = await runReviewPr({ root, pr: 7, repo: 'o/r', dryRun: false }, { run }, io);
    expect(code).toBe(1);
    expect(err).toEqual([`no .passback/inbox in ${root}`]);
  });
});
