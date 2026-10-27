import { describe, expect, it } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs', () => {
  it('parses "connect linear --key <key> --to <target> --json"', () => {
    expect(
      parseArgs(['connect', 'linear', '--key', 'lin_api_fake', '--to', 'ENG/Web', '--json']),
    ).toEqual({
      cmd: 'connect',
      tracker: 'linear',
      key: 'lin_api_fake',
      to: 'ENG/Web',
      json: true,
    });
  });

  it('parses "connect plane" with its workspace and a site', () => {
    expect(
      parseArgs([
        'connect',
        'plane',
        '--key',
        'plane_key_fake',
        '--workspace',
        'acme',
        '--site',
        'my-app',
      ]),
    ).toEqual({
      cmd: 'connect',
      tracker: 'plane',
      key: 'plane_key_fake',
      workspace: 'acme',
      site: 'my-app',
      json: false,
    });
  });

  it('returns usage for connect without a key, with an unknown tracker or plane without a workspace', () => {
    for (const args of [
      ['connect', 'plane', '--workspace', 'acme'],
      ['connect', 'jira', '--key', 'x'],
      ['connect', 'plane', '--key', 'plane_key_fake'],
      ['connect'],
      ['connect', 'github', '--key', 'x', '--workspace', 'acme'],
      ['connect', 'linear', '--key'],
      ['connect', 'linear', '--key', 'x', '--unknown'],
    ]) {
      expect(parseArgs(args)).toEqual({ cmd: 'usage', error: 'connect' });
    }
  });

  it('parses "site delete <name> --yes --json"', () => {
    expect(parseArgs(['site', 'delete', 'my-app', '--yes', '--json'])).toEqual({
      cmd: 'site-delete',
      name: 'my-app',
      yes: true,
      json: true,
    });
    expect(parseArgs(['site', 'delete', 'my-app'])).toEqual({
      cmd: 'site-delete',
      name: 'my-app',
      yes: false,
      json: false,
    });
  });

  it('returns usage for "site" without delete and a name', () => {
    for (const args of [
      ['site'],
      ['site', 'delete'],
      ['site', 'remove', 'x'],
      ['site', 'delete', '--yes'],
      ['site', 'delete', 'x', '--unknown'],
    ]) {
      expect(parseArgs(args)).toEqual({ cmd: 'usage', error: 'site' });
    }
  });

  it('parses "dev" with no options', () => {
    expect(parseArgs(['dev'])).toEqual({ cmd: 'dev' });
  });

  it('parses "dev --root <dir>"', () => {
    expect(parseArgs(['dev', '--root', '/tmp/app'])).toEqual({ cmd: 'dev', root: '/tmp/app' });
  });

  it('returns usage with no args', () => {
    expect(parseArgs([])).toEqual({ cmd: 'usage' });
  });

  it('returns usage naming an unknown subcommand', () => {
    expect(parseArgs(['bogus'])).toEqual({ cmd: 'usage', error: 'bogus' });
  });

  it('parses "--version"', () => {
    expect(parseArgs(['--version'])).toEqual({ cmd: 'version' });
  });

  it('parses "init" with no options', () => {
    expect(parseArgs(['init'])).toEqual({ cmd: 'init' });
  });

  it('parses "init --root <dir>"', () => {
    expect(parseArgs(['init', '--root', '/tmp/app'])).toEqual({ cmd: 'init', root: '/tmp/app' });
  });

  it('parses "init --agents" into a list', () => {
    expect(parseArgs(['init', '--agents', 'claude,codex'])).toEqual({
      cmd: 'init',
      agents: ['claude', 'codex'],
    });
  });

  it('parses "init --agents all"', () => {
    expect(parseArgs(['init', '--agents', 'all'])).toEqual({
      cmd: 'init',
      agents: ['claude', 'codex', 'cursor'],
    });
  });

  it('returns usage for an unknown agent name', () => {
    expect(parseArgs(['init', '--agents', 'vim'])).toEqual({ cmd: 'usage', error: '--agents vim' });
  });

  it('parses "init --app" once into a one-entry list', () => {
    expect(parseArgs(['init', '--app', 'apps/web'])).toEqual({ cmd: 'init', apps: ['apps/web'] });
  });

  it('parses a repeated "init --app" into a list in order', () => {
    expect(parseArgs(['init', '--app', 'apps/web', '--app', 'apps/admin'])).toEqual({
      cmd: 'init',
      apps: ['apps/web', 'apps/admin'],
    });
  });

  it('returns usage for "init --app" with no value', () => {
    expect(parseArgs(['init', '--app'])).toEqual({ cmd: 'usage', error: '--app' });
    expect(parseArgs(['init', '--app', '--root', '/x'])).toEqual({ cmd: 'usage', error: '--app' });
  });

  it('parses "init --site --json"', () => {
    expect(parseArgs(['init', '--site', '--json'])).toEqual({
      cmd: 'init',
      site: true,
      json: true,
    });
  });

  it('returns usage for "init --json" without --site', () => {
    expect(parseArgs(['init', '--json'])).toEqual({ cmd: 'usage', error: 'init --json' });
  });

  it('parses "init --site pb_abc --json" with the site key', () => {
    expect(parseArgs(['init', '--site', 'pb_abc', '--json'])).toEqual({
      cmd: 'init',
      site: true,
      siteKey: 'pb_abc',
      json: true,
    });
  });

  it('parses review-pr with a number', () => {
    expect(parseArgs(['review-pr', '12'])).toEqual({ cmd: 'review-pr', pr: 12, dryRun: false });
  });

  it('parses review-pr with repo, root and dry-run', () => {
    expect(
      parseArgs(['review-pr', '7', '--repo', 'acme/app', '--root', '/tmp/app', '--dry-run']),
    ).toEqual({ cmd: 'review-pr', pr: 7, repo: 'acme/app', root: '/tmp/app', dryRun: true });
  });

  it('returns usage for a review-pr number that is not a positive integer', () => {
    expect(parseArgs(['review-pr', '0'])).toEqual({ cmd: 'usage', error: 'review-pr 0' });
    expect(parseArgs(['review-pr', 'abc'])).toEqual({ cmd: 'usage', error: 'review-pr abc' });
    expect(parseArgs(['review-pr', '12', '--repo'])).toEqual({
      cmd: 'usage',
      error: 'review-pr 12',
    });
  });

  it('returns usage for review-pr with no number', () => {
    expect(parseArgs(['review-pr'])).toEqual({ cmd: 'usage', error: 'review-pr' });
  });

  it('parses pr-check with base and head', () => {
    expect(parseArgs(['pr-check', '--base', 'a.json', '--head', 'b.json'])).toEqual({
      cmd: 'pr-check',
      base: 'a.json',
      head: 'b.json',
      json: false,
    });
    expect(
      parseArgs(['pr-check', '--base', 'a.json', '--head', 'b.json', '--assertions', 'd', '--json']),
    ).toEqual({ cmd: 'pr-check', base: 'a.json', head: 'b.json', assertions: 'd', json: true });
  });

  it('returns usage for pr-check without head', () => {
    expect(parseArgs(['pr-check', '--base', 'a.json'])).toEqual({
      cmd: 'usage',
      error: 'pr-check',
    });
  });

  it('parses snapshot with url, routes, viewports and out', () => {
    expect(
      parseArgs([
        'snapshot',
        '--url',
        'http://localhost:5173',
        '--routes',
        '/,/cart',
        '--viewports',
        '375,1280',
        '--out',
        'head.json',
      ]),
    ).toEqual({
      cmd: 'snapshot',
      url: 'http://localhost:5173',
      routes: ['/', '/cart'],
      viewports: [375, 1280],
      out: 'head.json',
    });
  });

  it('returns usage for a snapshot url that is not an http or https address', () => {
    for (const url of ['localhost:5173', 'ftp://x', '//x', '/']) {
      expect(
        parseArgs(['snapshot', '--url', url, '--routes', '/', '--viewports', '375', '--out', 's.json']),
      ).toEqual({ cmd: 'usage', error: 'snapshot' });
    }
  });

  it('returns usage for snapshot without out', () => {
    expect(
      parseArgs(['snapshot', '--url', 'http://x', '--routes', '/', '--viewports', '375']),
    ).toEqual({ cmd: 'usage', error: 'snapshot' });
  });

  it('returns usage for a snapshot viewport that is not a positive integer', () => {
    expect(
      parseArgs([
        'snapshot',
        '--url',
        'http://x',
        '--routes',
        '/',
        '--viewports',
        '375,0',
        '--out',
        'o.json',
      ]),
    ).toEqual({ cmd: 'usage', error: 'snapshot' });
  });

  it('parses "login" with no options', () => {
    expect(parseArgs(['login'])).toEqual({ cmd: 'login', json: false });
  });

  it('parses "login --api <url> --json"', () => {
    expect(parseArgs(['login', '--api', 'http://127.0.0.1:8787', '--json'])).toEqual({
      cmd: 'login',
      api: 'http://127.0.0.1:8787',
      json: true,
    });
  });

  it('returns usage for "login --api" with no value', () => {
    expect(parseArgs(['login', '--api'])).toEqual({ cmd: 'usage', error: 'login' });
  });

  it('parses "whoami --json" and "logout"', () => {
    expect(parseArgs(['whoami', '--json'])).toEqual({ cmd: 'whoami', json: true });
    expect(parseArgs(['logout'])).toEqual({ cmd: 'logout', json: false });
  });

  it('returns usage for an unknown flag on whoami', () => {
    expect(parseArgs(['whoami', '--api', 'http://x'])).toEqual({ cmd: 'usage', error: 'whoami' });
  });
});
