import {
  commonFailure,
  fail,
  hostedCall,
  report,
  siteName,
  toSiteSummary,
  type Failure,
  type HostedAnswer,
  type HostedDeps,
  type SiteSummary,
} from './hosted';
import { CUSTOMER_TRACKERS, TRACKER_TRAITS } from '@passback/schema';
import type { ConnectArgs } from './args-connect';
import type { Choice, Target } from './connect-types';
import { adoAliases, adoBody, adoChoices } from './connect-ado';
import { asanaAliases, asanaBody, asanaChoices } from './connect-asana';
import { jiraAliases, jiraBody, jiraChoices } from './connect-jira';
import { intakeFields, planeFailure } from './connect-plane';
import { trelloAliases, trelloBody, trelloChoices } from './connect-trello';

export type { Choice, Target };
export type ConnectTracker = ConnectArgs['tracker'];
export type ConnectOptions = Omit<ConnectArgs, 'cmd' | 'key'> & { root: string; key: string };
type SelectionError = { error: 'no_targets' | 'pick_target' | 'no_match'; choices: Choice[] };
export const TRACKERS = Object.fromEntries(
  CUSTOMER_TRACKERS.map((tracker) => [tracker, TRACKER_TRAITS[tracker].label]),
) as Record<ConnectTracker, string>;
export function choices(tracker: ConnectTracker, targets: Target[], workspace?: string): Choice[] {
  if (tracker === 'jira') return jiraChoices(targets);
  if (tracker === 'asana') return asanaChoices(targets);
  if (tracker === 'azure-devops') return adoChoices(targets, workspace);
  if (tracker === 'trello') return trelloChoices(targets);
  return targets.flatMap((target) => {
    const team = { project: target.id, where: target.label };
    if (tracker === 'plane') return [{ ...team, where: `${workspace} / ${target.label}` }];
    if (TRACKER_TRAITS[tracker].targets === 'flat') return [team];
    return [
      team,
      ...(target.children ?? []).map((child) => ({
        project: target.id,
        projectId: child.id,
        where: `${target.label} / ${child.label}`,
      })),
    ];
  });
}

function linearAliases(choice: Choice, targets: Target[]): string[] {
  const team = targets.find((target) => target.id === choice.project);
  if (!team) return [];
  const key = team.label.split('·')[0]!.trim();
  if (choice.projectId === undefined) return [key];
  const child = team.children?.find((project) => project.id === choice.projectId);
  return child ? [`${key}/${child.label}`] : [];
}

function aliases(tracker: ConnectTracker, choice: Choice, targets: Target[]): string[] {
  if (tracker === 'linear') return linearAliases(choice, targets);
  if (tracker === 'jira') return jiraAliases(choice, targets);
  if (tracker === 'asana') return asanaAliases(choice, targets);
  if (tracker === 'azure-devops') return adoAliases(choice, targets);
  if (tracker === 'trello') return trelloAliases(choice, targets);
  if (tracker !== 'plane') return [];
  const target = targets.find((target) => target.id === choice.project);
  return target ? [target.label.split('·')[0]!.trim()] : [];
}

function isSingle(tracker: ConnectTracker, targets: Target[], list: Choice[]): boolean {
  if (TRACKER_TRAITS[tracker].targets === 'nested-only' || tracker === 'azure-devops') {
    return list.length === 1;
  }
  return targets.length === 1 && !targets[0]?.children?.length;
}

export function chooseTarget(
  tracker: ConnectTracker,
  targets: Target[],
  to: string | undefined,
  workspace?: string,
): Choice | SelectionError {
  const list = choices(tracker, targets, workspace);
  if (targets.length === 0) return { error: 'no_targets', choices: [] };
  if (to === undefined) {
    return isSingle(tracker, targets, list) ? list[0]! : { error: 'pick_target', choices: list };
  }
  const match = list.find((choice) =>
    [choice.where, choice.project, choice.projectId, ...aliases(tracker, choice, targets)].some(
      (value) => value?.trim().toLowerCase() === to.trim().toLowerCase(),
    ),
  );
  return match ?? { error: 'no_match', choices: list };
}

export function unexpected(answer: HostedAnswer): Failure {
  const api = answer.kind === 'signed_out' ? '' : answer.api;
  const status = answer.kind === 'answer' ? answer.status : 0;
  return { code: 'unexpected', message: `Unexpected answer from ${api} (${status}).` };
}

export function bodyCode(body: unknown): string | undefined {
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export async function findSite(
  opts: { root: string; site?: string },
  deps: HostedDeps,
): Promise<SiteSummary | Failure> {
  const name = opts.site ?? siteName(opts.root);
  const answer = await hostedCall(deps, 'GET', '/v1/customer/sites');
  const common = commonFailure(answer);
  if (common) return common;
  if (answer.kind !== 'answer' || answer.status !== 200 || !Array.isArray(answer.body)) {
    return unexpected(answer);
  }
  const sites = answer.body.map((entry) => toSiteSummary(entry, answer.api));
  const site =
    sites.find((site) => site?.siteId === name) ?? sites.find((site) => site?.name === name);
  return (
    site ?? {
      code: 'no_site',
      message: `No site named "${name}". Run npx passback init --site first, or pass --site <name>.`,
    }
  );
}

function trackerFailure(answer: HostedAnswer, opts: ConnectOptions): Failure | undefined {
  const common = commonFailure(answer);
  if (common) return common;
  if (answer.kind !== 'answer') return unexpected(answer);
  const code = bodyCode(answer.body);
  if (answer.status === 422 && code === 'credential_rejected') {
    return { code, message: `${TRACKERS[opts.tracker]} did not accept that key.` };
  }
  if (answer.status === 422) {
    const failure = planeFailure(code, opts);
    if (failure) return failure;
  }
  if (answer.status === 400 && code === 'bad_body' && opts.tracker === 'gitlab') {
    return {
      code,
      message:
        'That GitLab address cannot be used. Give the address you open GitLab at, starting with https:// and with nothing after the host name.',
    };
  }
  return undefined;
}

function credentialBody(opts: ConnectOptions): Record<string, unknown> {
  return {
    tracker: opts.tracker,
    credential: opts.key,
    ...((opts.tracker === 'plane' || opts.tracker === 'azure-devops') && {
      workspace: opts.workspace,
    }),
    ...(opts.tracker === 'gitlab' && opts.url !== undefined && { gitlabUrl: opts.url }),
  };
}

async function verify(opts: ConnectOptions, deps: HostedDeps): Promise<Target[] | Failure> {
  const answer = await hostedCall(
    deps,
    'POST',
    '/v1/customer/integrations/verify',
    credentialBody(opts),
  );
  const failure = trackerFailure(answer, opts);
  if (failure) return failure;
  if (answer.kind !== 'answer') return unexpected(answer);
  if (answer.status === 502)
    return {
      code: 'tracker_unreachable',
      message: `${TRACKERS[opts.tracker]} could not be reached. Try again in a minute.`,
    };
  const targets = (answer.body as { targets?: Target[] } | null)?.targets;
  return answer.status === 200 && Array.isArray(targets) ? targets : unexpected(answer);
}

function destinationBody(opts: ConnectOptions, choice: Choice): Record<string, unknown> {
  if (opts.tracker === 'jira') return jiraBody(opts.key, choice);
  if (opts.tracker === 'asana') return asanaBody(opts.key, choice);
  if (opts.tracker === 'azure-devops') return adoBody(opts, choice);
  if (opts.tracker === 'trello') return trelloBody(opts.key, choice);
  return {
    ...credentialBody(opts),
    project: choice.project,
    ...intakeFields(opts),
    ...(opts.tracker === 'linear' &&
      choice.projectId !== undefined && { projectId: choice.projectId }),
  };
}

type Destination = { site: SiteSummary; choice: Choice };
async function save(
  opts: ConnectOptions,
  deps: HostedDeps,
  destination: Destination,
): Promise<Failure | undefined> {
  const { site, choice } = destination;
  const answer = await hostedCall(
    deps,
    'PUT',
    `/v1/customer/sites/${encodeURIComponent(site.siteId)}/integration`,
    destinationBody(opts, choice),
  );
  const failure = trackerFailure(answer, opts);
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

type TestComment = { ref: string; url: string | null };
export async function testComment(
  site: SiteSummary,
  deps: HostedDeps,
): Promise<TestComment | Failure> {
  const answer = await hostedCall(
    deps,
    'POST',
    `/v1/customer/sites/${encodeURIComponent(site.siteId)}/test-mark`,
  );
  const common = commonFailure(answer);
  if (common) return common;
  if (answer.kind !== 'answer') return unexpected(answer);
  if (answer.status !== 200)
    return {
      code: 'test_failed',
      message: `The destination is saved, but the test comment could not be filed (${bodyCode(answer.body) ?? answer.status}). Run the same command again to retry.`,
    };
  const body = answer.body as { ref?: unknown; url?: unknown } | null;
  if (typeof body?.ref !== 'string') return unexpected(answer);
  return { ref: body.ref, url: typeof body.url === 'string' ? body.url : null };
}

const noTargets = (tracker: ConnectTracker): string =>
  tracker === 'notion'
    ? 'That secret cannot see any database. In Notion, open the database, choose the ••• menu, then Connections, and add your integration.'
    : 'That key cannot see any team, project or repository.';
function selectionFailure(error: SelectionError, opts: ConnectOptions, deps: HostedDeps): 1 {
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

export async function runConnect(opts: ConnectOptions, deps: HostedDeps): Promise<number> {
  const site = await findSite(opts, deps);
  if ('code' in site) return fail(deps, opts.json, site);
  const targets = await verify(opts, deps);
  if (!Array.isArray(targets)) return fail(deps, opts.json, targets);
  const choice = chooseTarget(opts.tracker, targets, opts.to, opts.workspace);
  if ('error' in choice) return selectionFailure(choice, opts, deps);
  const failure = await save(opts, deps, { site, choice });
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
