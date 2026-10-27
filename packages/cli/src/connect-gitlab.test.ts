import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountDeps } from './account';
import { chooseTarget, runConnect, type ConnectOptions } from './connect';
import { connectCommand } from './connect-command';
import { writeCredentials } from './credentials';
import type { HostedDeps } from './hosted';

const KEY = 'glpat-secret-value';
const API = 'https://api.example.test';
const ADDRESS = 'https://gitlab.example.com';
const targets = [
  { id: '42', label: 'acme/web' },
  { id: '77', label: 'acme/api' },
];
type Recorded = { method: string; url: string; body?: string };
type Reply = { status: number; body?: unknown };
function view(siteId: string, name: string) {
  return { siteId, name, origins: [], snippet: '<script></script>' };
}

describe('connect gitlab', () => {
  let dir: string;
  let requests: Recorded[];
  let outLines: string[];
  let errLines: string[];
  let replies: Reply[];

  function deps(): HostedDeps & AccountDeps {
    return {
      credentialsPath: path.join(dir, 'credentials.json'),
      out: (line) => outLines.push(line),
      err: (line) => errLines.push(line),
      sleep: async () => {},
      openUrl: () => {},
      hostname: 'host',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          method: init?.method ?? 'GET',
          url: String(input),
          body: init?.body as string | undefined,
        });
        const reply = replies.shift() ?? { status: 404 };
        return new Response(JSON.stringify(reply.body), { status: reply.status });
      }) as typeof fetch,
    };
  }
  function opts(extra: Partial<ConnectOptions> = {}): ConnectOptions {
    return {
      root: path.join(dir, 'shop'),
      tracker: 'gitlab',
      key: KEY,
      url: ADDRESS,
      to: 'acme/web',
      json: false,
      ...extra,
    };
  }
  function success(): void {
    replies = [
      { status: 200, body: [view('s1', 'shop')] },
      { status: 200, body: { account: 'acme', targets } },
      { status: 200, body: view('s1', 'shop') },
      { status: 200, body: { ref: 'acme/web#1', url: 'https://gitlab.example.com/1' } },
    ];
  }
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-connect-gitlab-'));
    requests = [];
    outLines = [];
    errLines = [];
    process.exitCode = undefined;
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: 'pbt_token',
    });
    success();
  });
  afterEach(async () => {
    process.exitCode = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('sends the token and the typed address to verify and saves the picked project id', async () => {
    expect(await runConnect(opts(), deps())).toBe(0);
    expect(JSON.parse(requests[1]!.body!)).toEqual({
      tracker: 'gitlab',
      credential: KEY,
      gitlabUrl: ADDRESS,
    });
    expect(requests[2]!.method).toBe('PUT');
    expect(JSON.parse(requests[2]!.body!)).toEqual({
      tracker: 'gitlab',
      credential: KEY,
      gitlabUrl: ADDRESS,
      project: '42',
    });
    expect(outLines.join('\n')).toContain('Comments from this site go to acme/web in GitLab.');
  });

  it('matches --to by the group and project path or by the numeric id', () => {
    expect(chooseTarget('gitlab', targets, 'ACME/api')).toEqual({
      project: '77',
      where: 'acme/api',
    });
    expect(chooseTarget('gitlab', targets, '42')).toEqual({ project: '42', where: 'acme/web' });
    expect(chooseTarget('gitlab', targets, 'nope')).toMatchObject({ error: 'no_match' });
  });

  it('names GitLab in a rejected-token, an unreachable and a bad-address message', async () => {
    replies = [
      { status: 200, body: [view('s1', 'shop')] },
      { status: 422, body: { code: 'credential_rejected' } },
    ];
    expect(await runConnect(opts(), deps())).toBe(1);
    expect(errLines.join('\n')).toContain('GitLab did not accept that key.');

    errLines = [];
    replies = [
      { status: 200, body: [view('s1', 'shop')] },
      { status: 502, body: { code: 'unreachable' } },
    ];
    expect(await runConnect(opts(), deps())).toBe(1);
    expect(errLines.join('\n')).toContain('GitLab could not be reached. Try again in a minute.');

    errLines = [];
    replies = [
      { status: 200, body: [view('s1', 'shop')] },
      { status: 400, body: { code: 'bad_body' } },
    ];
    expect(await runConnect(opts(), deps())).toBe(1);
    expect(errLines.join('\n')).toContain(
      'That GitLab address cannot be used. Give the address you open GitLab at, starting with https:// and with nothing after the host name.',
    );
  });

  it('sends a GitLab connect to the key flow and never to the browser flow', async () => {
    await connectCommand(
      {
        cmd: 'connect',
        tracker: 'gitlab',
        key: KEY,
        url: ADDRESS,
        to: 'acme/web',
        site: 'shop',
        json: false,
      },
      deps(),
    );
    expect(process.exitCode).toBe(0);
    expect(requests.map((request) => request.url)).toEqual([
      `${API}/v1/customer/sites`,
      `${API}/v1/customer/integrations/verify`,
      `${API}/v1/customer/sites/s1/integration`,
      `${API}/v1/customer/sites/s1/test-mark`,
    ]);
    expect(requests.some((request) => request.url.includes('connect-session'))).toBe(false);
  });
});
