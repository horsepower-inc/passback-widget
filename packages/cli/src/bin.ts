#!/usr/bin/env node
// The `passback` binary the developer's agent launches.
// stdout carries only MCP frames once `dev` connects; everything else here goes to stderr.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { startMcpServer } from '@passback/daemon';
import { apiBase, runLogin, runLogout, runWhoami, type AccountDeps } from './account';
import type { AgentId } from './agent-select';
import { formatPlanned } from './init-apply';
import { parseArgs, type ParsedArgs } from './args';
import { runBilling } from './billing';
import { runClear } from './clear';
import { connectCommand } from './connect-command';
import { runConnectWebhook } from './connect-webhook';
import { credentialsPath } from './credentials';
import { createGhRun } from './gh-run';
import { runInitSite } from './hosted';
import { runInit } from './init-run';
import { keyedSite } from './init-site-key';
import { runPrCheck } from './pr-check';
import { runReviewPr } from './review-pr';
import { runSiteDelete } from './site-delete';
import type { SiteOptions } from './site-options';
import { loadPlaywright, runSnapshot } from './snapshot';
import { usageMessage } from './usage-message';

const USAGE = [
  'usage: passback dev [--root <dir>]',
  '       passback init [--root <dir>] [--agents <claude,codex,cursor|all>] [--app <dir>] [--apply] [--site [<site key>]] [--yes] [--json]',
  '       passback review-pr <n> [--repo owner/name] [--root <dir>] [--dry-run]',
  '       passback pr-check --base <file> --head <file> [--assertions <dir>] [--json]',
  '       passback snapshot --url <base> --routes <r1,r2> --viewports <w1,w2> --out <file>',
  '       passback clear [--fixed|--tracker|--all] [--yes] [--root <dir>]',
  '       passback login [--api <url>] [--json]',
  '       passback whoami [--json]',
  '       passback logout [--json]',
  '       passback billing [--json]',
  '       passback site delete <name> [--yes] [--json]',
  '       passback connect <linear|github|plane|jira|asana|clickup> [--key <key>] [--to <target>] [--workspace <slug>] [--site <name>] [--json]',
  '       passback connect trello --key <key> --token <token> [--to <target>] [--site <name>] [--json]',
  '       passback connect gitlab --key <token> [--url <https address>] [--to <target>] [--site <name>] [--json]',
  '       passback connect azure-devops --workspace <organization> --key <token> [--to <project>] [--type <bug|task>] [--site <name>] [--json]',
  '       passback connect webhook --url <https address> [--site <name>] [--json]',
].join('\n');

function readVersion(): string {
  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}

function agentsLine(agents: AgentId[]): string {
  return agents.length === 0
    ? 'agents: none detected (pass --agents claude,codex,cursor to choose)'
    : `agents: ${agents.join(', ')}`;
}

async function initCommand(parsed: Extract<ParsedArgs, { cmd: 'init' }>): Promise<void> {
  const root = parsed.root ?? process.cwd();
  let site: SiteOptions | undefined;
  if (parsed.site && parsed.siteKey) {
    site = keyedSite(parsed.siteKey, process.env, { out: console.log, err: console.error });
    if (!site) {
      process.exitCode = 1;
      return;
    }
  } else if (parsed.site) {
    const created = await runInitSite(
      { root, json: parsed.json === true, siteKey: parsed.siteKey, yes: parsed.yes === true },
      accountDeps(),
    );
    if (!created.ok) {
      process.exitCode = 1;
      return;
    }
    site = { siteKey: created.site.siteId, endpoint: created.site.endpoint };
  }
  const result = await runInit(root, {
    agents: parsed.agents,
    apps: parsed.apps,
    site,
    apply: parsed.apply === true,
  });
  if (parsed.json) {
    const { framework, agents, written, planned, printed, nextSteps } = result;
    console.log(
      JSON.stringify({ event: 'init', framework, agents, written, planned, printed, nextSteps }),
    );
    return;
  }
  printInitResult(result);
  printConnectNextStep(parsed.site);
}

function printInitResult(result: Awaited<ReturnType<typeof runInit>>): void {
  console.log(`framework: ${result.framework}`);
  console.log(agentsLine(result.agents));
  for (const app of result.apps) {
    console.log(`app ${app.dir}: ${app.framework}`);
  }
  if (result.written.length === 0) {
    console.log('already set up');
  } else {
    for (const path of result.written) {
      console.log(`wrote ${path}`);
    }
  }
  const lines = [...formatPlanned(result.planned), ...result.printed, ...result.nextSteps];
  for (const line of lines) {
    console.log(line);
  }
}

function printConnectNextStep(site: boolean | undefined): void {
  if (site) {
    console.log(
      'Next: send comments to a tracker with npx passback connect linear (or jira, or github, or plane --workspace <slug> --key <key>, or trello --key <key> --token <token>).',
    );
  }
}

async function reviewPrCommand(parsed: Extract<ParsedArgs, { cmd: 'review-pr' }>): Promise<void> {
  process.exitCode = await runReviewPr(
    { root: parsed.root ?? process.cwd(), pr: parsed.pr, repo: parsed.repo, dryRun: parsed.dryRun },
    { run: createGhRun() },
    { out: console.log, err: console.error },
  );
}

async function prCheckCommand(parsed: Extract<ParsedArgs, { cmd: 'pr-check' }>): Promise<void> {
  process.exitCode = await runPrCheck(
    { base: parsed.base, head: parsed.head, assertionsDir: parsed.assertions, json: parsed.json },
    { out: console.log, err: console.error },
  );
}

async function snapshotCommand(parsed: Extract<ParsedArgs, { cmd: 'snapshot' }>): Promise<void> {
  const { url, routes, viewports, out } = parsed;
  process.exitCode = await runSnapshot(
    { url, routes, viewports, out },
    { load: loadPlaywright, write: (file, text) => writeFile(file, text, 'utf8') },
    { out: console.log, err: console.error },
  );
}

/** Opens the sign-in page; a missing opener is ignored because the address is also printed. */
function openUrl(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The printed address is enough.
  }
}

function accountDeps(): AccountDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    openUrl,
    hostname: os.hostname(),
    credentialsPath: credentialsPath(process.env, os.homedir()),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  };
}

async function accountCommand(
  parsed: Extract<ParsedArgs, { cmd: 'login' | 'whoami' | 'logout' }>,
): Promise<void> {
  if (parsed.cmd === 'login') {
    process.exitCode = await runLogin(
      { api: apiBase(parsed.api, process.env), json: parsed.json },
      accountDeps(),
    );
  } else if (parsed.cmd === 'whoami') {
    process.exitCode = await runWhoami({ json: parsed.json }, accountDeps());
  } else {
    process.exitCode = await runLogout({ json: parsed.json }, accountDeps());
  }
}

async function askSiteName(question: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await terminal.question(question);
  } finally {
    terminal.close();
  }
}

async function siteDeleteCommand(
  parsed: Extract<ParsedArgs, { cmd: 'site-delete' }>,
): Promise<void> {
  const { name, yes, json } = parsed;
  const ask = process.stdin.isTTY && !json ? askSiteName : undefined;
  process.exitCode = await runSiteDelete({ name, yes, json }, { ...accountDeps(), ask });
}

function usageCommand(parsed: Extract<ParsedArgs, { cmd: 'usage' }>): void {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (parsed.error !== undefined) {
    console.error(usageMessage(parsed.error));
  }
  console.error(USAGE);
  process.exitCode = 2;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  switch (parsed.cmd) {
    case 'version':
      console.log(readVersion());
      return;
    case 'usage':
      usageCommand(parsed);
      return;
    case 'dev':
      await startMcpServer({ root: parsed.root });
      return;
    case 'review-pr':
      await reviewPrCommand(parsed);
      return;
    case 'pr-check':
      await prCheckCommand(parsed);
      return;
    case 'snapshot':
      await snapshotCommand(parsed);
      return;
    case 'site-delete':
      await siteDeleteCommand(parsed);
      return;
    case 'clear':
      process.exitCode = await runClear(parsed, {
        root: parsed.root ?? process.cwd(),
        ask: process.stdin.isTTY ? askSiteName : undefined,
        out: console.log,
        err: console.error,
      });
      return;
    case 'init':
      await initCommand(parsed);
      return;
    default:
      await hostedCommand(parsed);
      return;
  }
}

async function hostedCommand(
  parsed: Extract<
    ParsedArgs,
    { cmd: 'connect' | 'connect-webhook' | 'login' | 'whoami' | 'logout' | 'billing' }
  >,
): Promise<void> {
  switch (parsed.cmd) {
    case 'billing':
      process.exitCode = await runBilling({ json: parsed.json, nowMs: Date.now() }, accountDeps());
      return;
    case 'connect':
      await connectCommand(parsed, accountDeps());
      return;
    case 'connect-webhook':
      process.exitCode = await runConnectWebhook(
        {
          root: process.cwd(),
          url: parsed.url,
          ...(parsed.site !== undefined && { site: parsed.site }),
          json: parsed.json,
        },
        accountDeps(),
      );
      return;
    default:
      await accountCommand(parsed);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
