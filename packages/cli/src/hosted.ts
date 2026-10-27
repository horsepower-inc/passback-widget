// Hosted commands of the CLI: init --site, and the hosted call helpers re-exported for its callers.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { detectFramework, type DetectedFramework } from './detect-framework';
import { scanApps } from './detect-apps';
import {
  addSiteCents,
  addSiteLines,
  PAUSED_LINE,
  readBilling,
  type BillingSummary,
} from './billing';
import {
  commonFailure,
  fail,
  hostedCall,
  report,
  type Failure,
  type HostedDeps,
} from './hosted-call';

export {
  commonFailure,
  fail,
  hostedCall,
  report,
  type Failure,
  type HostedAnswer,
  type HostedDeps,
} from './hosted-call';

export type SiteSummary = { siteId: string; name: string; origins: string[]; endpoint: string };
type ProjectPackage = { framework: DetectedFramework; scripts: Record<string, string> };

export function siteName(root: string): string {
  const name = path.basename(path.resolve(root)).trim().slice(0, 80).trim();
  return name === '' ? 'site' : name;
}

const PORT_SCRIPTS = ['dev', 'start', 'preview'];

function scriptPorts(scripts: Record<string, string>): number[] {
  const ports: number[] = [];
  for (const [key, value] of Object.entries(scripts)) {
    if (!PORT_SCRIPTS.includes(key)) continue;
    for (const match of value.matchAll(/(?:--port|-p)[ =](\d{2,5})\b/g)) {
      ports.push(Number(match[1]));
    }
  }
  return ports;
}

function frameworkPorts(framework: DetectedFramework): number[] {
  if (framework === 'vite' || framework === 'vite-react') return [5173, 4173];
  return framework === 'next' ? [3000] : [];
}

export function localOrigins(packages: ProjectPackage[]): string[] {
  const found = new Set<number>();
  for (const pkg of packages) {
    for (const port of [...scriptPorts(pkg.scripts), ...frameworkPorts(pkg.framework)]) {
      found.add(port);
    }
  }
  if (found.size === 0) {
    found.add(3000);
    found.add(5173);
  }
  return [...found]
    .sort((a, b) => a - b)
    .slice(0, 10)
    .map((port) => `http://localhost:${port}`);
}

async function readPackage(file: string): Promise<ProjectPackage | undefined> {
  try {
    const pkg: unknown = JSON.parse(await readFile(file, 'utf8'));
    const raw = (pkg as { scripts?: unknown } | null)?.scripts;
    return { framework: detectFramework(pkg), scripts: stringEntries(raw) };
  } catch {
    return undefined;
  }
}

function stringEntries(raw: unknown): Record<string, string> {
  const entries = typeof raw === 'object' && raw !== null ? Object.entries(raw) : [];
  const strings = entries.filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return Object.fromEntries(strings);
}

export async function readProjectPackages(root: string): Promise<ProjectPackage[]> {
  const files = [path.join(root, 'package.json')];
  for (const app of await scanApps(root)) {
    files.push(path.join(root, app.dir, 'package.json'));
  }
  const packages: ProjectPackage[] = [];
  for (const file of files) {
    const pkg = await readPackage(file);
    if (pkg !== undefined) packages.push(pkg);
  }
  return packages;
}

export function toSiteSummary(view: unknown, api?: string): SiteSummary | undefined {
  if (typeof view !== 'object' || view === null) return undefined;
  const { siteId, name, snippet, origins } = view as Record<string, unknown>;
  if (typeof siteId !== 'string' || typeof name !== 'string' || typeof snippet !== 'string') {
    return undefined;
  }
  if (!isStringArray(origins)) return undefined;
  const match = /data-passback-endpoint="(https?:\/\/[^"]+?)\/v1\/ingest\/[^"/]+"/.exec(snippet);
  return { siteId, name, origins, endpoint: match?.[1] ?? api ?? '' };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

type Found = {
  site: SiteSummary;
  created: boolean;
  view?: BillingSummary;
  after?: { lines: string[]; sites: number; costs: boolean };
};

function unexpected(api: string, status: number): Failure {
  return { code: 'unexpected', message: `Unexpected answer from ${api} (${status}).` };
}

function findSite(
  list: unknown[],
  api: string,
  match: { name: string; siteKey?: string },
): SiteSummary | undefined {
  for (const entry of list) {
    const site = toSiteSummary(entry, api);
    if (site === undefined) continue;
    if (match.siteKey === undefined ? site.name === match.name : site.siteId === match.siteKey) {
      return site;
    }
  }
  return undefined;
}

async function createSite(root: string, name: string, deps: HostedDeps): Promise<Found | Failure> {
  const origins = localOrigins(await readProjectPackages(root));
  const answer = await hostedCall(deps, 'POST', '/v1/customer/sites', { name, origins });
  const common = commonFailure(answer);
  if (common) return common;
  if (answer.kind !== 'answer') return unexpected('', 0);
  if (answer.status === 409) {
    return {
      code: 'site_limit',
      message:
        'This account already has 20 sites, the most it can have. Delete one in the dashboard, then run this again.',
    };
  }
  const site = answer.status === 201 ? toSiteSummary(answer.body, answer.api) : undefined;
  return site ? { site, created: true } : unexpected(answer.api, answer.status);
}

async function addNewSite(
  opts: { root: string; name: string; sites: number; view?: BillingSummary; yes?: boolean },
  deps: HostedDeps,
): Promise<Found | Failure> {
  const { lines, costs } = addSiteLines(opts.view, opts.sites);
  if (costs && opts.yes !== true) {
    return {
      code: 'confirm_needed',
      message: `${lines.at(-1)}. Run again with --yes to add the site.`,
    };
  }
  const made = await createSite(opts.root, opts.name, deps);
  if ('code' in made) return made;
  return { ...made, view: opts.view, after: { lines, sites: opts.sites, costs } };
}

async function findOrCreate(
  opts: { root: string; siteKey?: string; yes?: boolean },
  deps: HostedDeps,
): Promise<Found | Failure> {
  const name = siteName(opts.root);
  const answer = await hostedCall(deps, 'GET', '/v1/customer/sites');
  const common = commonFailure(answer);
  if (common) return common;
  if (answer.kind !== 'answer') return unexpected('', 0);
  const list = answer.status === 200 && Array.isArray(answer.body) ? answer.body : undefined;
  if (list === undefined) return unexpected(answer.api, answer.status);
  const view = await readBilling(deps);
  const existing = findSite(list, answer.api, { name, siteKey: opts.siteKey });
  if (existing) return { site: existing, created: false, view };
  if (opts.siteKey !== undefined) {
    return {
      code: 'site_not_found',
      message: `No site with the key ${opts.siteKey} in this account. Copy the command again from the dashboard.`,
    };
  }
  return addNewSite({ ...opts, name, sites: list.length + 1, view }, deps);
}

function reportSite(deps: HostedDeps, json: boolean, found: Found): void {
  const { site, created, view, after } = found;
  const paused = view?.state === 'paused';
  report(
    deps,
    json,
    {
      event: 'site',
      created,
      siteKey: site.siteId,
      name: site.name,
      origins: site.origins,
      endpoint: site.endpoint,
      ...(after && { sites: after.sites, addsCents: after.costs ? addSiteCents(view) : 0 }),
      paused,
    },
    [
      created
        ? `Created site "${site.name}" for ${site.origins.join(', ')}.`
        : `Using the existing site "${site.name}".`,
      `Site key: ${site.siteId}`,
      `Endpoint: ${site.endpoint}`,
      ...(after?.lines ?? []),
      ...(paused ? [PAUSED_LINE, 'Pay with npx passback billing.'] : []),
    ],
  );
}

export async function runInitSite(
  opts: { root: string; json: boolean; siteKey?: string; yes?: boolean },
  deps: HostedDeps,
): Promise<{ ok: true; site: SiteSummary } | { ok: false }> {
  const found = await findOrCreate(opts, deps);
  if ('code' in found) {
    fail(deps, opts.json, found);
    return { ok: false };
  }
  reportSite(deps, opts.json, found);
  return { ok: true, site: found.site };
}
