import { parseAgentList, type AgentId } from './agent-select';
import { parseConnect, type ConnectArgs, type WebhookConnectArgs } from './args-connect';
import { readFlags } from './read-flags';
import { readRoot } from './root-flag';

export type ParsedArgs =
  | { cmd: 'dev'; root?: string }
  | {
      cmd: 'init';
      root?: string;
      agents?: AgentId[];
      apps?: string[];
      site?: true;
      siteKey?: string;
      json?: true;
      yes?: true;
      apply?: true;
    }
  | { cmd: 'review-pr'; pr: number; repo?: string; root?: string; dryRun: boolean }
  | { cmd: 'pr-check'; base: string; head: string; assertions?: string; json: boolean }
  | { cmd: 'snapshot'; url: string; routes: string[]; viewports: number[]; out: string }
  | {
      cmd: 'clear';
      scope: 'fixed' | 'tracker' | 'workspace';
      settings: boolean;
      yes: boolean;
      root?: string;
    }
  | { cmd: 'login'; api?: string; json: boolean }
  | { cmd: 'whoami'; json: boolean }
  | { cmd: 'logout'; json: boolean }
  | { cmd: 'billing'; json: boolean }
  | { cmd: 'site-delete'; name: string; yes: boolean; json: boolean }
  | ConnectArgs
  | WebhookConnectArgs
  | { cmd: 'version' }
  | { cmd: 'usage'; error?: string; help?: true };

const INFO_FLAGS = new Map<string, ParsedArgs>([
  ['--version', { cmd: 'version' }],
  ['--help', { cmd: 'usage', help: true }],
  ['-h', { cmd: 'usage', help: true }],
  ['help', { cmd: 'usage', help: true }],
]);

/** Pure parser for `passback`'s argv; `bin.ts` only wires its result to actions. */
export function parseArgs(argv: string[]): ParsedArgs {
  const [head, ...rest] = argv;

  if (head === undefined) {
    return { cmd: 'usage' };
  }

  const info = INFO_FLAGS.get(head);
  if (info !== undefined) {
    return info;
  }

  if (head === 'dev') {
    return parseDev(rest);
  }

  if (head === 'init') {
    return parseInit(rest);
  }

  if (head === 'review-pr') {
    return parseReviewPr(rest);
  }

  if (head === 'pr-check') {
    return parsePrCheck(rest);
  }

  if (head === 'snapshot') {
    return parseSnapshot(rest);
  }

  if (head === 'clear') {
    return parseClear(rest);
  }

  return parseHostedCommand(head, rest);
}

type AccountCommand = 'login' | 'whoami' | 'logout';

function isAccountCommand(head: string): head is AccountCommand {
  return ['login', 'whoami', 'logout'].includes(head);
}

function parseAccount(head: AccountCommand, rest: string[]): ParsedArgs {
  const flags = readFlags(rest, head === 'login' ? ['--api'] : [], ['--json']);
  if (flags === undefined) {
    return { cmd: 'usage', error: head };
  }
  const json = flags.bare.has('--json');
  if (head !== 'login') {
    return { cmd: head, json };
  }
  const api = flags.values.get('--api');
  return { cmd: 'login', ...(api !== undefined && { api }), json };
}

function parseBilling(rest: string[]): ParsedArgs {
  const flags = readFlags(rest, [], ['--json']);
  if (flags === undefined) return { cmd: 'usage', error: 'billing' };
  return { cmd: 'billing', json: flags.bare.has('--json') };
}

function parseReviewPr(rest: string[]): ParsedArgs {
  const [value, ...flagArgs] = rest;
  if (value === undefined) {
    return { cmd: 'usage', error: 'review-pr' };
  }
  const flags = readFlags(flagArgs, ['--repo', '--root'], ['--dry-run']);
  if (!/^[1-9][0-9]*$/.test(value) || flags === undefined) {
    return { cmd: 'usage', error: `review-pr ${value}` };
  }
  const repo = flags.values.get('--repo');
  const root = flags.values.get('--root');
  return {
    cmd: 'review-pr',
    pr: Number(value),
    ...(repo !== undefined && { repo }),
    ...(root !== undefined && { root }),
    dryRun: flags.bare.has('--dry-run'),
  };
}

function parsePrCheck(rest: string[]): ParsedArgs {
  const flags = readFlags(rest, ['--base', '--head', '--assertions'], ['--json']);
  const base = flags?.values.get('--base');
  const head = flags?.values.get('--head');
  if (flags === undefined || base === undefined || head === undefined) {
    return { cmd: 'usage', error: 'pr-check' };
  }
  const assertions = flags.values.get('--assertions');
  return {
    cmd: 'pr-check',
    base,
    head,
    ...(assertions !== undefined && { assertions }),
    json: flags.bare.has('--json'),
  };
}

function isWebAddress(url: string | undefined): url is string {
  return url !== undefined && /^https?:\/\//.test(url);
}

function parseSnapshot(rest: string[]): ParsedArgs {
  const flags = readFlags(rest, ['--url', '--routes', '--viewports', '--out'], []);
  const url = flags?.values.get('--url');
  const out = flags?.values.get('--out');
  const routes = readList(flags?.values.get('--routes'), /^\/.*$/);
  const viewports = readList(flags?.values.get('--viewports'), /^[1-9][0-9]*$/);
  if (!isWebAddress(url) || out === undefined || routes === undefined || viewports === undefined) {
    return { cmd: 'usage', error: 'snapshot' };
  }
  return { cmd: 'snapshot', url, routes, viewports: viewports.map(Number), out };
}

/** `clear [--fixed|--tracker|--all] [--yes] [--root <dir>]`; at most one scope flag. */
function parseClear(rest: string[]): ParsedArgs {
  const flags = readFlags(rest, ['--root'], ['--fixed', '--tracker', '--all', '--yes']);
  const scopes = ['--fixed', '--tracker', '--all'].filter((flag) => flags?.bare.has(flag));
  if (flags === undefined || scopes.length > 1) {
    return { cmd: 'usage', error: 'clear' };
  }
  const scope = flags.bare.has('--fixed')
    ? 'fixed'
    : flags.bare.has('--tracker')
      ? 'tracker'
      : 'workspace';
  const root = flags.values.get('--root');
  return {
    cmd: 'clear',
    scope,
    settings: flags.bare.has('--all'),
    yes: flags.bare.has('--yes'),
    ...(root !== undefined && { root }),
  };
}

/** Splits a comma list; undefined when the value is missing or any entry fails `entry`. */
function readList(value: string | undefined, entry: RegExp): string[] | undefined {
  const items = value?.split(',');
  return items?.every((item) => entry.test(item)) ? items : undefined;
}

function parseDev(rest: string[]): ParsedArgs {
  if (rest.includes('--apply')) {
    return { cmd: 'usage', error: 'dev --apply' };
  }
  const root = readRoot(rest);
  return root === undefined ? { cmd: 'usage', error: '--root' } : { cmd: 'dev', ...root };
}

function parseInit(rest: string[]): ParsedArgs {
  const root = readRoot(rest);
  if (root === undefined) {
    return { cmd: 'usage', error: '--root' };
  }
  const result: ParsedArgs = { cmd: 'init', ...root };
  const apps = readApps(rest);
  if (apps === undefined) {
    return { cmd: 'usage', error: '--app' };
  }
  const hosted = readSiteFlags(rest);
  if ('error' in hosted) {
    return { cmd: 'usage', error: hosted.error };
  }
  const apply = rest.includes('--apply');
  const withApps: ParsedArgs = {
    ...result,
    ...(apps.length > 0 && { apps }),
    ...hosted,
    ...(apply && { apply: true }),
  };
  const agentsIndex = rest.indexOf('--agents');
  if (agentsIndex === -1) {
    return withApps;
  }
  const value = rest[agentsIndex + 1] ?? '';
  const agents = parseAgentList(value);
  if ('error' in agents) {
    return { cmd: 'usage', error: '--agents ' + value };
  }
  return { ...withApps, agents };
}

/** The values of every `--app`; undefined when one lacks its value. */
function readApps(rest: string[]): string[] | undefined {
  const apps: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--app') {
      const dir = rest[i + 1];
      if (dir === undefined || dir.startsWith('--')) {
        return undefined;
      }
      apps.push(dir);
      i++;
    }
  }
  return apps;
}

/** The `--site [<key>]`, `--json` and `--yes` flags of init; an error names the flag that came without `--site`. */
function readSiteFlags(
  rest: string[],
): { site?: true; siteKey?: string; json?: true; yes?: true } | { error: string } {
  const json = rest.includes('--json');
  const yes = rest.includes('--yes');
  const siteIndex = rest.indexOf('--site');
  if (siteIndex === -1) {
    return json ? { error: 'init --json' } : yes ? { error: 'init --yes' } : {};
  }
  const next = rest[siteIndex + 1];
  const siteKey = next !== undefined && !next.startsWith('--') ? next : undefined;
  return {
    site: true,
    ...(siteKey !== undefined && { siteKey }),
    ...(json && { json: true }),
    ...(yes && { yes: true }),
  };
}

function parseSite(rest: string[]): ParsedArgs {
  const [command, name, ...flagArgs] = rest;
  if (command !== 'delete' || name === undefined || name.startsWith('--')) {
    return { cmd: 'usage', error: 'site' };
  }
  const flags = readFlags(flagArgs, [], ['--yes', '--json']);
  if (flags === undefined) return { cmd: 'usage', error: 'site' };
  return { cmd: 'site-delete', name, yes: flags.bare.has('--yes'), json: flags.bare.has('--json') };
}

function parseHostedCommand(head: string, rest: string[]): ParsedArgs {
  if (head === 'connect') return parseConnect(rest);
  if (head === 'site') return parseSite(rest);
  if (head === 'billing') return parseBilling(rest);
  if (isAccountCommand(head)) return parseAccount(head, rest);
  return { cmd: 'usage', error: head };
}
