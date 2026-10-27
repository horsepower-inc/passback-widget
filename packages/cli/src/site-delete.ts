import {
  commonFailure,
  fail,
  hostedCall,
  report,
  toSiteSummary,
  type Failure,
  type HostedAnswer,
  type HostedDeps,
  type SiteSummary,
} from './hosted';

export type SiteDeleteDeps = HostedDeps & { ask?: (question: string) => Promise<string> };
type Options = { name: string; yes: boolean; json: boolean };

function unexpected(answer: HostedAnswer): Failure {
  return (
    commonFailure(answer) ?? {
      code: 'unexpected',
      message:
        answer.kind === 'answer'
          ? `Unexpected answer from ${answer.api} (${answer.status}).`
          : 'Unexpected answer.',
    }
  );
}

function notFound(name: string): Failure {
  return { code: 'not_found', message: `No site named "${name}".` };
}

async function findSite(name: string, deps: HostedDeps): Promise<SiteSummary | Failure> {
  const answer = await hostedCall(deps, 'GET', '/v1/customer/sites');
  if (answer.kind !== 'answer' || answer.status !== 200 || !Array.isArray(answer.body)) {
    return unexpected(answer);
  }
  const sites = answer.body
    .map((entry: unknown) => toSiteSummary(entry, answer.api))
    .filter((site): site is SiteSummary => site !== undefined);
  const keys = sites.filter((site) => site.siteId === name);
  const matches = keys.length > 0 ? keys : sites.filter((site) => site.name === name);
  if (matches.length === 0) return notFound(name);
  if (matches.length > 1) {
    return {
      code: 'ambiguous',
      message: `${matches.length} sites are named "${name}". Pass the site key instead: ${matches.map((site) => site.siteId).join(', ')}.`,
    };
  }
  return matches[0] as SiteSummary;
}

async function confirmSite(
  site: SiteSummary,
  yes: boolean,
  deps: SiteDeleteDeps,
): Promise<Failure | undefined> {
  if (yes) return undefined;
  if (deps.ask === undefined) {
    return {
      code: 'confirm_needed',
      message: `Nothing was deleted. To delete without a prompt, run: npx passback site delete "${site.name}" --yes`,
    };
  }
  const typed = await deps.ask(`Type the site name (${site.name}) to delete it: `);
  if (typed.trim() !== site.name) {
    return { code: 'not_confirmed', message: 'The name did not match. Nothing was deleted.' };
  }
  return undefined;
}

async function deleteSite(
  site: SiteSummary,
  name: string,
  deps: HostedDeps,
): Promise<Failure | undefined> {
  const answer = await hostedCall(deps, 'DELETE', `/v1/customer/sites/${site.siteId}`);
  if (answer.kind === 'answer' && answer.status === 204) return undefined;
  if (answer.kind === 'answer' && answer.status === 404) return notFound(name);
  return unexpected(answer);
}

export async function runSiteDelete(opts: Options, deps: SiteDeleteDeps): Promise<number> {
  const site = await findSite(opts.name, deps);
  if ('code' in site) return fail(deps, opts.json, site);
  const confirmation = await confirmSite(site, opts.yes, deps);
  if (confirmation) return fail(deps, opts.json, confirmation);
  const failure = await deleteSite(site, opts.name, deps);
  if (failure) return fail(deps, opts.json, failure);
  report(deps, opts.json, { event: 'deleted', name: site.name, siteKey: site.siteId }, [
    `Deleted site "${site.name}" (${site.siteId}). Its site key stops working and its tracker connection is removed. Comments already filed stay in the tracker.`,
  ]);
  return 0;
}
