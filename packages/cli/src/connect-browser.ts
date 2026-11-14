// passback connect linear|github without a key: approve in the browser, wait, then runConnect.

import type { AccountDeps } from './account';
import { runConnect } from './connect';
import { siteName, toSiteSummary } from './hosted';
import {
  commonFailure,
  fail,
  hostedCall,
  report,
  type Failure,
  type HostedAnswer,
  type HostedDeps,
} from './hosted-call';

export type ConnectBrowserDeps = HostedDeps & Pick<AccountDeps, 'sleep' | 'openUrl'>;
export const POLL_MS = 2000;
export const WAIT_MS = 15 * 60_000;

type Tracker = 'linear' | 'github' | 'jira';
type BrowserOptions = {
  root: string;
  tracker: Tracker;
  to?: string;
  site?: string;
  json: boolean;
};
type Approval = { url: string; handle: string };
const TRACKER = { linear: 'Linear', github: 'GitHub', jira: 'Jira' };
const APPROVE = {
  linear: 'Approve Passback in Linear',
  github: 'Install the Passback GitHub App',
  jira: 'Approve Passback in Atlassian',
};
const FAILURES: Record<string, string> = {
  denied: 'The connection was cancelled in the browser.',
  install_requested:
    'Your GitHub organisation owner has to approve the Passback app first. Run the command again once they have.',
  installation_not_yours: 'Your GitHub account cannot see that installation of the Passback app.',
};
const OTHER_FAILURE = 'Passback could not finish the connection. Run the command again.';
const EXPIRED: Failure = {
  code: 'expired',
  message: 'The approval expired. Run the command again.',
};

function unexpected(answer: HostedAnswer): Failure {
  const api = answer.kind === 'signed_out' ? '' : answer.api;
  const status = answer.kind === 'answer' ? answer.status : 0;
  return { code: 'unexpected', message: `Unexpected answer from ${api} (${status}).` };
}

async function findSiteId(opts: BrowserOptions, deps: HostedDeps): Promise<string | Failure> {
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
  if (site) return site.siteId;
  return {
    code: 'no_site',
    message: `No site named "${name}". Run npx passback init --site first, or pass --site <name>.`,
  };
}

function isApproval(body: unknown): body is Approval {
  const { url, handle } = (body ?? {}) as { url?: unknown; handle?: unknown };
  return (
    typeof url === 'string' &&
    /^https?:\/\//.test(url) &&
    typeof handle === 'string' &&
    handle.startsWith('pbc_')
  );
}

async function start(
  opts: BrowserOptions,
  deps: HostedDeps,
  siteId: string,
): Promise<Approval | Failure> {
  const answer = await hostedCall(
    deps,
    'POST',
    `/v1/customer/sites/${encodeURIComponent(siteId)}/connect/${opts.tracker}?from=cli`,
  );
  if (answer.kind === 'answer' && answer.status === 503) {
    return {
      code: 'browser_unavailable',
      message: `Connecting ${TRACKER[opts.tracker]} in the browser is not set up on ${answer.api}.${opts.tracker === 'jira' ? '' : ' Run the command again with --key <key>.'}`,
    };
  }
  const common = commonFailure(answer);
  if (common) return common;
  if (answer.kind === 'answer' && answer.status === 200 && isApproval(answer.body)) {
    return answer.body;
  }
  return unexpected(answer);
}

function tell(opts: BrowserOptions, deps: ConnectBrowserDeps, url: string): void {
  report(deps, opts.json, { event: 'approve', tracker: opts.tracker, url }, [
    `${APPROVE[opts.tracker]}: ${url}`,
    'Waiting for the approval in your browser…',
  ]);
  deps.openUrl(url);
}

function flowState(answer: HostedAnswer, body: Record<string, unknown>): FlowResult {
  if (body.state === 'ready' || body.state === 'waiting') return body.state;
  if (body.state !== 'failed') return unexpected(answer);
  const reason = typeof body.failure === 'string' ? body.failure : '';
  return { code: 'failure', message: FAILURES[reason] ?? OTHER_FAILURE };
}

type FlowResult = 'waiting' | 'ready' | Failure;
function flowResult(answer: HostedAnswer): FlowResult {
  if (answer.kind === 'unreachable') return 'waiting';
  if (answer.kind === 'answer' && answer.status === 404) return EXPIRED;
  const common = commonFailure(answer);
  if (common) return common;
  if (answer.kind !== 'answer' || answer.status !== 200) return unexpected(answer);
  return flowState(answer, (answer.body ?? {}) as Record<string, unknown>);
}

async function wait(deps: ConnectBrowserDeps, handle: string): Promise<Failure | undefined> {
  for (let slept = 0; slept < WAIT_MS; slept += POLL_MS) {
    await deps.sleep(POLL_MS);
    const result = flowResult(
      await hostedCall(deps, 'GET', `/v1/customer/connect/flows/${encodeURIComponent(handle)}`),
    );
    if (result === 'ready') return undefined;
    if (result !== 'waiting') return result;
  }
  return EXPIRED;
}

export async function runConnectBrowser(
  opts: BrowserOptions,
  deps: ConnectBrowserDeps,
): Promise<number> {
  const siteId = await findSiteId(opts, deps);
  if (typeof siteId !== 'string') return fail(deps, opts.json, siteId);
  const approval = await start(opts, deps, siteId);
  if (!isApproval(approval)) return fail(deps, opts.json, approval as Failure);
  tell(opts, deps, approval.url);
  const failure = await wait(deps, approval.handle);
  if (failure) return fail(deps, opts.json, failure);
  return runConnect(
    {
      root: opts.root,
      tracker: opts.tracker,
      key: approval.handle,
      ...(opts.to !== undefined && { to: opts.to }),
      site: siteId,
      json: opts.json,
    },
    deps,
  );
}
