// passback connect --keep-key: a new destination for a connected site, verified and saved with
// the tracker key the site already has. No tracker key leaves this machine because none is here.

import { TRACKER_TRAITS } from '@passback/schema';
import {
  TRACKERS,
  bodyCode,
  chooseTarget,
  findSite,
  testComment,
  unexpected,
  type Choice,
  type ConnectTracker,
  type Target,
} from './connect';
import { intakeFields, intakeNotEnabled } from './connect-plane';
import { readCredentials } from './credentials';
import {
  commonFailure,
  fail,
  hostedCall,
  report,
  type Failure,
  type HostedAnswer,
  type HostedDeps,
} from './hosted';

export type ConnectEditOptions = {
  root: string;
  tracker: ConnectTracker;
  site?: string;
  to?: string;
  workItemType?: 'Bug' | 'Task';
  intake?: boolean;
  json: boolean;
};
type SelectionError = { error: 'no_targets' | 'pick_target' | 'no_match'; choices: Choice[] };

/** A copy of hostedCall for PATCH, which the shared helper does not take. */
async function patchCall(deps: HostedDeps, urlPath: string, body: unknown): Promise<HostedAnswer> {
  const creds = await readCredentials(deps.credentialsPath);
  if (!creds) return { kind: 'signed_out' };
  const headers: Record<string, string> = {
    authorization: `Bearer ${creds.accessToken}`,
    accept: 'application/json',
    'content-type': 'application/json',
  };
  try {
    const res = await deps.fetch(creds.api + urlPath, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    return {
      kind: 'answer',
      api: creds.api,
      status: res.status,
      body: parseJson(await res.text()),
    };
  } catch {
    return { kind: 'unreachable', api: creds.api };
  }
}

function parseJson(text: string): unknown {
  try {
    return text === '' ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

const EDIT_FAILURES: Record<string, (tracker: ConnectTracker) => string> = {
  '422 credential_rejected': (tracker) =>
    `The saved key no longer works. Run passback connect ${tracker} with a new key.`,
  '422 intake_not_enabled': (tracker) => intakeNotEnabled(tracker).message,
  '409 tracker_changed': () => 'This site is connected to another tracker.',
  '409 not_editable': () => 'This connection cannot be edited this way.',
};

function editFailure(answer: HostedAnswer, tracker: ConnectTracker): Failure | undefined {
  const common = commonFailure(answer);
  if (common) return common;
  if (answer.kind !== 'answer') return unexpected(answer);
  const code = bodyCode(answer.body);
  const known = EDIT_FAILURES[`${answer.status} ${code}`];
  if (code !== undefined && known) return { code, message: known(tracker) };
  if (answer.status === 502) {
    return {
      code: 'tracker_unreachable',
      message: `${TRACKERS[tracker]} could not be reached. Try again in a minute.`,
    };
  }
  return undefined;
}

async function verifyStored(
  opts: ConnectEditOptions,
  deps: HostedDeps,
  integration: string,
): Promise<Target[] | Failure> {
  const answer = await hostedCall(deps, 'POST', `${integration}/verify`);
  const failure = editFailure(answer, opts.tracker);
  if (failure) return failure;
  if (answer.kind !== 'answer') return unexpected(answer);
  const targets = (answer.body as { targets?: Target[] } | null)?.targets;
  return answer.status === 200 && Array.isArray(targets) ? targets : unexpected(answer);
}

function targetFields(opts: ConnectEditOptions, choice: Choice): Record<string, unknown> {
  const { parent } = TRACKER_TRAITS[opts.tracker];
  if (parent !== null) return { [parent]: choice.project, project: choice.projectId };
  return {
    ...intakeFields(opts),
    project: choice.project,
    projectId: opts.tracker === 'linear' ? choice.projectId : undefined,
    workItemType: opts.tracker === 'azure-devops' ? opts.workItemType : undefined,
  };
}

/** The destination fields only; the server keeps the credential it already has. */
function targetBody(opts: ConnectEditOptions, choice: Choice): Record<string, unknown> {
  const present = Object.entries(targetFields(opts, choice)).filter(
    ([, value]) => value !== undefined,
  );
  return { tracker: opts.tracker, ...Object.fromEntries(present) };
}

async function saveTarget(
  opts: ConnectEditOptions,
  deps: HostedDeps,
  integration: string,
  choice: Choice,
): Promise<Failure | undefined> {
  const answer = await patchCall(deps, integration, targetBody(opts, choice));
  const failure = editFailure(answer, opts.tracker);
  if (failure) return failure;
  if (answer.kind !== 'answer') return unexpected(answer);
  if (answer.status === 400 && bodyCode(answer.body) === 'target_not_visible') {
    return {
      code: 'target_not_visible',
      message: `${TRACKERS[opts.tracker]} no longer shows ${choice.where} to that key.`,
    };
  }
  return answer.status === 200 ? undefined : unexpected(answer);
}

/** Plane and Azure DevOps choices name a workspace this mode does not have; show the target label. */
function labelled(tracker: ConnectTracker, targets: Target[], choice: Choice): Choice {
  if (tracker !== 'plane' && tracker !== 'azure-devops') return choice;
  const target = targets.find((entry) => entry.id === choice.project);
  return target ? { ...choice, where: target.label } : choice;
}

const noTargets = (tracker: ConnectTracker): string =>
  tracker === 'notion'
    ? 'That secret cannot see any database. In Notion, open the database, choose the ••• menu, then Connections, and add your integration.'
    : 'That key cannot see any team, project or repository.';
function selectionFailure(
  error: SelectionError,
  opts: { tracker: ConnectTracker; json: boolean },
  deps: HostedDeps,
): 1 {
  if (error.error === 'no_targets')
    return fail(deps, opts.json, { code: error.error, message: noTargets(opts.tracker) });
  const message = 'Pick where comments go with --to. Choices:';
  const wheres = error.choices.map((choice) => choice.where);
  if (opts.json) {
    deps.out(JSON.stringify({ event: 'error', code: error.error, message, choices: wheres }));
    return 1;
  }
  deps.err(message);
  for (const where of wheres) deps.err(`  ${where}`);
  return 1;
}

export async function runConnectEdit(opts: ConnectEditOptions, deps: HostedDeps): Promise<number> {
  const site = await findSite(opts, deps);
  if ('code' in site) return fail(deps, opts.json, site);
  const integration = `/v1/customer/sites/${encodeURIComponent(site.siteId)}/integration`;
  const targets = await verifyStored(opts, deps, integration);
  if (!Array.isArray(targets)) return fail(deps, opts.json, targets);
  const picked = chooseTarget(opts.tracker, targets, opts.to);
  if ('error' in picked) {
    const choices = picked.choices.map((choice) => labelled(opts.tracker, targets, choice));
    return selectionFailure({ ...picked, choices }, opts, deps);
  }
  const choice = labelled(opts.tracker, targets, picked);
  const failure = await saveTarget(opts, deps, integration, choice);
  if (failure) return fail(deps, opts.json, failure);
  const comment = await testComment(site, deps);
  if ('code' in comment) return fail(deps, opts.json, comment);
  report(
    deps,
    opts.json,
    {
      event: 'connected',
      site: site.name,
      tracker: opts.tracker,
      where: choice.where,
      testComment: comment,
    },
    [
      `Test comment filed: ${comment.ref}${comment.url ? ` ${comment.url}` : ''}`,
      `Comments from this site go to ${choice.where} in ${TRACKERS[opts.tracker]}.`,
    ],
  );
  return 0;
}
