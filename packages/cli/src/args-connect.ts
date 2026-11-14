import { CUSTOMER_TRACKERS, type Tracker } from '@passback/schema';
import { trelloKey } from './connect-trello';
import { readFlags } from './read-flags';

export type ConnectArgs = {
  cmd: 'connect';
  tracker: Tracker;
  key?: string;
  url?: string;
  to?: string;
  workspace?: string;
  site?: string;
  workItemType?: 'Bug' | 'Task';
  keepKey?: true;
  intake?: boolean;
  json: boolean;
};

const CONNECT_WEBHOOK = 'connect-webhook';

export type WebhookConnectArgs = {
  cmd: typeof CONNECT_WEBHOOK;
  url: string;
  site?: string;
  json: boolean;
};

/** Plane and Azure DevOps need a key and a workspace; GitLab, Trello, Notion, Asana and ClickUp need a key and take no workspace; Jira takes neither; the other trackers take no workspace and may leave the key out. */
function isComplete(tracker: ConnectArgs['tracker'], key?: string, workspace?: string): boolean {
  if (tracker === 'plane' || tracker === 'azure-devops')
    return key !== undefined && workspace !== undefined;
  if (tracker === 'jira') return key === undefined && workspace === undefined;
  if (['gitlab', 'trello', 'notion', 'asana', 'clickup'].includes(tracker))
    return key !== undefined && workspace === undefined;
  return workspace === undefined;
}

/** Trello takes a token next to its key and no other tracker does. */
function isTokenAllowed(tracker: ConnectArgs['tracker'], token?: string): boolean {
  return (tracker === 'trello') === (token !== undefined);
}

/** Only GitLab takes an address, and it must be https. */
function isUrlAllowed(tracker: ConnectArgs['tracker'], url?: string): boolean {
  return url === undefined || (tracker === 'gitlab' && url.startsWith('https://'));
}

function isUrlAndIntakeAllowed(
  tracker: ConnectArgs['tracker'],
  url?: string,
  intake?: boolean | null,
): boolean {
  return isUrlAllowed(tracker, url) && intake !== null;
}

function isTracker(value: string | undefined): value is ConnectArgs['tracker'] {
  return value !== undefined && (CUSTOMER_TRACKERS as readonly string[]).includes(value);
}

/** `--type` is for Azure DevOps only and takes bug or task in any case; null is a usage error. */
function parseWorkItemType(
  tracker: ConnectArgs['tracker'],
  value?: string,
): ConnectArgs['workItemType'] | null {
  if (value === undefined) return undefined;
  const type = value.toLowerCase();
  if (tracker !== 'azure-devops' || (type !== 'bug' && type !== 'task')) return null;
  return type === 'bug' ? 'Bug' : 'Task';
}

/** `--intake` and `--no-intake` are for Plane only and exclude each other; null is a usage error. */
function parseIntake(
  tracker: ConnectArgs['tracker'],
  bare: Set<string>,
): boolean | undefined | null {
  const on = bare.has('--intake');
  const off = bare.has('--no-intake');
  if (!on && !off) return undefined;
  return tracker === 'plane' && on !== off ? on : null;
}

function parseWebhook(flagArgs: string[]): WebhookConnectArgs | { cmd: 'usage'; error: 'connect' } {
  const flags = readFlags(flagArgs, ['--url', '--site'], ['--json']);
  const url = flags?.values.get('--url');
  if (flags === undefined || url === undefined || !url.startsWith('https://')) {
    return { cmd: 'usage', error: 'connect' };
  }
  const site = flags.values.get('--site');
  return {
    cmd: CONNECT_WEBHOOK,
    url,
    ...(site !== undefined && { site }),
    json: flags.bare.has('--json'),
  };
}

/** `--keep-key` reuses the stored credential, so it takes no credential or address. */
function parseKeepKey(
  tracker: string | undefined,
  flagArgs: string[],
): ConnectArgs | { cmd: 'usage'; error: 'connect' } {
  const flags = readFlags(
    flagArgs,
    ['--key', '--token', '--to', '--workspace', '--url', '--site', '--type'],
    ['--json', '--keep-key', '--intake', '--no-intake'],
  );
  if (!isTracker(tracker) || flags === undefined) {
    return { cmd: 'usage', error: 'connect' };
  }
  if (['--key', '--token', '--workspace', '--url'].some((flag) => flags.values.has(flag))) {
    return { cmd: 'usage', error: 'connect' };
  }
  const workItemType = parseWorkItemType(tracker, flags.values.get('--type'));
  if (workItemType === null) return { cmd: 'usage', error: 'connect' };
  const intake = parseIntake(tracker, flags.bare);
  if (intake === null) return { cmd: 'usage', error: 'connect' };
  const optional = {
    workItemType,
    to: flags.values.get('--to'),
    site: flags.values.get('--site'),
    intake,
  };
  return {
    cmd: 'connect',
    tracker,
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    keepKey: true,
    json: flags.bare.has('--json'),
  };
}

function parseSpecial(
  tracker: string | undefined,
  flagArgs: string[],
): ConnectArgs | WebhookConnectArgs | { cmd: 'usage'; error: 'connect' } | undefined {
  if (tracker === 'webhook') return parseWebhook(flagArgs);
  if (flagArgs.includes('--keep-key')) return parseKeepKey(tracker, flagArgs);
  return undefined;
}

export function parseConnect(
  rest: string[],
): ConnectArgs | WebhookConnectArgs | { cmd: 'usage'; error: 'connect' } {
  const [tracker, ...flagArgs] = rest;
  const special = parseSpecial(tracker, flagArgs);
  if (special) return special;
  if (!isTracker(tracker)) {
    return { cmd: 'usage', error: 'connect' };
  }
  const flags = readFlags(
    flagArgs,
    ['--key', '--token', '--to', '--workspace', '--url', '--site', '--type'],
    ['--json', '--intake', '--no-intake'],
  );
  if (flags === undefined) return { cmd: 'usage', error: 'connect' };
  const token = flags.values.get('--token');
  const workspace = flags.values.get('--workspace');
  const pasted = flags.values.get('--key');
  if (!isComplete(tracker, pasted, workspace) || !isTokenAllowed(tracker, token)) {
    return { cmd: 'usage', error: 'connect' };
  }
  const url = flags.values.get('--url');
  const intake = parseIntake(tracker, flags.bare);
  if (!isUrlAndIntakeAllowed(tracker, url, intake)) {
    return { cmd: 'usage', error: 'connect' };
  }
  const workItemType = parseWorkItemType(tracker, flags.values.get('--type'));
  if (workItemType === null) return { cmd: 'usage', error: 'connect' };
  const key = token === undefined || pasted === undefined ? pasted : trelloKey(pasted, token);
  const optional = {
    intake,
    workItemType,
    key,
    to: flags.values.get('--to'),
    workspace,
    url,
    site: flags.values.get('--site'),
  };
  return {
    cmd: 'connect',
    tracker,
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    json: flags.bare.has('--json'),
  };
}
