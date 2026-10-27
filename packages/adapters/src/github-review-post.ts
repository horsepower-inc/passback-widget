// Posts the open local marks as one PR review through the developer's own gh CLI. No token is held
// here: GhRun is a port, the CLI slice owns the real one, and every failure comes back as a value.

import type { InboxFile } from '@passback/inbox';
import { commentableLines } from './pr-diff-lines';
import { renderPrReview, type PrReview } from './github-review';

export type GhRun = (args: string[], stdin?: string) => Promise<{ code: number; stdout: string }>;

export type PostOutcome =
  | { ok: true; posted: boolean; review?: PrReview; inline: string[]; unplaced: string[] }
  | { ok: false; reason: string };

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MARKER = /<!-- passback:mark:(.+?) -->/g;
const PAGE_SIZE = 100;
const MAX_PAGES = 30;

class Failure extends Error {}

async function call(run: GhRun, step: string, args: string[], stdin?: string): Promise<string> {
  let result: { code: number; stdout: string };
  try {
    result = await run(args, stdin);
  } catch (err) {
    throw new Failure(`gh could not run: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (result.code !== 0) throw new Failure(`gh exited ${result.code} on ${step}`);
  return result.stdout;
}

function parse(step: string, stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Failure(`unexpected gh output on ${step}`);
  }
}

async function pages(run: GhRun, step: string, base: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let n = 1; n <= MAX_PAGES; n += 1) {
    const page = parse(
      step,
      await call(run, step, ['api', `${base}?per_page=${PAGE_SIZE}&page=${n}`]),
    );
    if (!Array.isArray(page)) throw new Failure(`unexpected gh output on ${step}`);
    for (const item of page) {
      if (item && typeof item === 'object') all.push(item as Record<string, unknown>);
    }
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

async function readHead(run: GhRun, base: string): Promise<string> {
  const pull = parse('pull request', await call(run, 'pull request', ['api', base]));
  const sha = (pull as { head?: { sha?: unknown } } | null)?.head?.sha;
  if (typeof sha !== 'string') throw new Failure('cannot read the pull request head');
  return sha;
}

async function readLines(run: GhRun, base: string): Promise<Map<string, Set<number>>> {
  const lines = new Map<string, Set<number>>();
  for (const file of await pages(run, 'files', `${base}/files`)) {
    if (typeof file.filename !== 'string') continue;
    lines.set(
      file.filename,
      commentableLines(typeof file.patch === 'string' ? file.patch : undefined),
    );
  }
  return lines;
}

async function readPosted(run: GhRun, base: string): Promise<Set<string>> {
  const posted = new Set<string>();
  for (const step of ['comments', 'reviews']) {
    const items = await pages(run, step, `${base}/${step}`);
    const bodies = items.map((i) => i.body).filter((b): b is string => typeof b === 'string');
    for (const m of bodies.flatMap((b) => [...b.matchAll(MARKER)])) posted.add(m[1] ?? '');
  }
  return posted;
}

async function runReview(
  run: GhRun,
  base: string,
  opts: { marks: readonly InboxFile[]; dryRun?: boolean },
): Promise<PostOutcome> {
  const commitId = await readHead(run, base);
  const lines = await readLines(run, base);
  const alreadyPosted = await readPosted(run, base);
  const rendered = renderPrReview(opts.marks, {
    commitId,
    isCommentable: (path, line) => lines.get(path)?.has(line) ?? false,
    alreadyPosted,
  });
  if (!rendered) return { ok: true, posted: false, inline: [], unplaced: [] };
  const { review, inline, unplaced } = rendered;
  if (opts.dryRun) return { ok: true, posted: false, review, inline, unplaced };
  const args = ['api', '-X', 'POST', `${base}/reviews`, '--input', '-'];
  await call(run, 'post review', args, JSON.stringify(review));
  return { ok: true, posted: true, review, inline, unplaced };
}

export async function postPrReview(
  run: GhRun,
  opts: { repo: string; pr: number; marks: readonly InboxFile[]; dryRun?: boolean },
): Promise<PostOutcome> {
  const { repo, pr } = opts;
  if (!REPO.test(repo)) return { ok: false, reason: 'repo must be owner/name' };
  if (!Number.isInteger(pr) || pr <= 0)
    return { ok: false, reason: 'pr must be a positive integer' };
  try {
    return await runReview(run, `repos/${repo}/pulls/${pr}`, opts);
  } catch (err) {
    if (err instanceof Failure) return { ok: false, reason: err.message };
    return { ok: false, reason: 'gh could not run: unexpected error' };
  }
}
