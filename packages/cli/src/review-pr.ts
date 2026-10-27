// `passback review-pr`: posts the open local inbox marks as one PR review through the developer's gh.
//
// Known limit: a mark's `file` is relative to the Vite project root, and GitHub paths are relative
// to the repository root. In a monorepo whose Vite root is a subdirectory the paths do not match,
// so every mark lands in the review body (never rejected). Not solved here.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { postPrReview, type GhRun } from '@passback/adapters/local';
import { parse, type InboxFile } from '@passback/inbox';

type Io = { out(line: string): void; err(line: string): void };

const GH_HINT = 'passback review-pr needs the GitHub CLI: install gh and run gh auth login';

async function readInbox(dir: string, io: Io): Promise<InboxFile[] | undefined> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return undefined;
  }
  const marks: InboxFile[] = [];
  for (const name of names.filter((n) => n.endsWith('.md')).sort()) {
    try {
      marks.push(parse(await readFile(path.join(dir, name), 'utf8')));
    } catch (err) {
      io.err(`skipped ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return marks;
}

async function resolveRepo(
  repo: string | undefined,
  run: GhRun,
  io: Io,
): Promise<string | undefined> {
  if (repo !== undefined) return repo;
  try {
    const result = await run(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
    const resolved = result.stdout.trim();
    if (result.code === 0 && resolved) return resolved;
    io.err('could not find the repository: pass --repo owner/name');
    return undefined;
  } catch {
    io.err(GH_HINT);
    return undefined;
  }
}

export async function runReviewPr(
  opts: { root: string; pr: number; repo?: string; dryRun: boolean },
  deps: { run: GhRun },
  io: Io,
): Promise<0 | 1> {
  const marks = await readInbox(path.join(opts.root, '.passback', 'inbox'), io);
  if (!marks) {
    io.err(`no .passback/inbox in ${opts.root}`);
    return 1;
  }
  const repo = await resolveRepo(opts.repo, deps.run, io);
  if (repo === undefined) return 1;
  const outcome = await postPrReview(deps.run, {
    repo,
    pr: opts.pr,
    marks,
    dryRun: opts.dryRun,
  });
  if (!outcome.ok) {
    io.err(`passback review-pr: ${outcome.reason}`);
    if (outcome.reason.startsWith('gh could not run')) io.err(GH_HINT);
    return 1;
  }
  if (!outcome.review) io.out('no open marks to post');
  else if (opts.dryRun) io.out(JSON.stringify(outcome.review, null, 2));
  else {
    io.out(
      `posted review on ${repo}#${opts.pr}: ${outcome.inline.length} inline, ${outcome.unplaced.length} in the review body`,
    );
  }
  return 0;
}
