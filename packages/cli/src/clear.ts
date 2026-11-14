// `passback clear`: the terminal twin of the Inbox panel's clear actions. The adapter does the
// work; this module only asks before a workspace clear and prints the counts.

import path from 'node:path';
import { clearInbox } from '@passback/adapters/local';

export type ClearOptions = {
  scope: 'fixed' | 'tracker' | 'workspace';
  settings: boolean;
  yes: boolean;
};

export type ClearDeps = {
  root: string;
  ask?: (question: string) => Promise<string>;
  out: (line: string) => void;
  err: (line: string) => void;
};

const WORKSPACE_QUESTION =
  'Clear every comment, screenshot, recording, answer and done file in .passback/? An agent working on a comment is told to stop. Type yes to continue: ';
const SETTINGS_QUESTION =
  'Delete the whole .passback/ folder, settings included? Run passback init to set it up again. Type yes to continue: ';

/** True when the developer agreed; `fixed` and `tracker` never ask. */
async function confirmed(opts: ClearOptions, deps: ClearDeps): Promise<boolean> {
  if (opts.scope !== 'workspace' || opts.yes) return true;
  if (deps.ask === undefined) {
    const all = opts.settings ? ' --all' : '';
    deps.err(`Nothing was cleared. To clear without a prompt, run: npx passback clear${all} --yes`);
    return false;
  }
  const answer = await deps.ask(opts.settings ? SETTINGS_QUESTION : WORKSPACE_QUESTION);
  if (['yes', 'y'].includes(answer.trim().toLowerCase())) return true;
  deps.err('Nothing was cleared.');
  return false;
}

export async function runClear(opts: ClearOptions, deps: ClearDeps): Promise<number> {
  if (!(await confirmed(opts, deps))) return 1;
  const { scope, settings } = opts;
  const result = await clearInbox(path.join(deps.root, '.passback'), {
    v: 1,
    scope,
    ...(settings && { settings: true }),
  });
  if (!result.ok) {
    deps.err(`Could not clear (${result.error}).`);
    return 1;
  }
  const { cleared } = result;
  const label = settings ? 'workspace and settings' : scope;
  deps.out(
    `Cleared ${label}: ${cleared.comments} comments, ${cleared.attachments} attachments, ${cleared.answers} answers, ${cleared.done} done.`,
  );
  if (cleared.settings) {
    deps.out('Deleted the .passback folder. Run npx passback init to set it up again.');
  }
  deps.out('Issues already filed in a tracker stay in the tracker.');
  return 0;
}
