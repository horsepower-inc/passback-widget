import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeCredentials } from './credentials';
import type { HostedDeps } from './hosted';
import { choices, chooseTarget, runConnect, type ConnectOptions } from './connect';

const TOKEN = 'pbt_secret_token_value';
const KEY = 'pasted_secret_key_value';
const API = 'https://api.example.test';
const targets = [
  { id: 't1', label: 'ENG · Engineering', children: [{ id: 'p1', label: 'Web' }] },
  { id: 't2', label: 'OPS · Ops' },
];
type Recorded = { method: string; url: string; headers: Record<string, string>; body?: string };
type Reply = { status: number; body?: unknown };
function view(siteId: string, name: string) {
  return { siteId, name, origins: [], snippet: '<script></script>' };
}

describe('connect', () => {
  let dir: string;
  let requests: Recorded[];
  let outLines: string[];
  let errLines: string[];
  let replies: Reply[];

  function deps(): HostedDeps {
    return {
      credentialsPath: path.join(dir, 'credentials.json'),
      out: (line) => outLines.push(line),
      err: (line) => errLines.push(line),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          method: init?.method ?? 'GET',
          url: String(input),
          headers: init?.headers as Record<string, string>,
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
      tracker: 'linear',
      key: KEY,
      to: 'eng/web',
      json: false,
      ...extra,
    };
  }
  function success(visible = targets): void {
    replies = [
      { status: 200, body: [view('s1', 'shop')] },
      { status: 200, body: { account: 'ACME', targets: visible } },
      { status: 200, body: view('s1', 'shop') },
      { status: 200, body: { ref: 'ENG-1', url: 'https://tracker.test/1' } },
    ];
  }
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-connect-'));
    requests = [];
    outLines = [];
    errLines = [];
    replies = [];
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: TOKEN,
    });
    success();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists a choice per Linear team and per Linear project', () => {
    expect(choices('linear', targets)).toEqual([
      { project: 't1', where: 'ENG · Engineering' },
      { project: 't1', projectId: 'p1', where: 'ENG · Engineering / Web' },
      { project: 't2', where: 'OPS · Ops' },
    ]);
    expect(choices('plane', [{ id: 'p', label: 'WEB · Website' }], 'acme')).toEqual([
      { project: 'p', where: 'acme / WEB · Website' },
    ]);
    expect(choices('github', [{ id: 'acme/web', label: 'acme/web' }])).toEqual([
      { project: 'acme/web', where: 'acme/web' },
    ]);
  });
  it('picks the only target when there is one and asks to pick when there are several', async () => {
    expect(chooseTarget('linear', [targets[1]!], undefined)).toEqual({
      project: 't2',
      where: 'OPS · Ops',
    });
    expect(chooseTarget('linear', targets, undefined)).toEqual({
      error: 'pick_target',
      choices: choices('linear', targets),
    });
    expect(chooseTarget('linear', [targets[0]!], undefined)).toHaveProperty('error', 'pick_target');
    expect(chooseTarget('linear', [], undefined)).toEqual({ error: 'no_targets', choices: [] });
    expect(await runConnect(opts({ to: undefined, json: true }), deps())).toBe(1);
    expect(JSON.parse(outLines[0]!)).toMatchObject({
      event: 'error',
      code: 'pick_target',
      choices: choices('linear', targets).map((c) => c.where),
    });
    expect(requests).toHaveLength(2);
  });
  it('matches --to by label, id or Linear team key, without regard to case', () => {
    for (const to of [' eng/web ', 'P1', 'eng · engineering / web']) {
      expect(chooseTarget('linear', targets, to)).toEqual({
        project: 't1',
        projectId: 'p1',
        where: 'ENG · Engineering / Web',
      });
    }
    for (const to of ['ENG', 't1', 'ENG · Engineering']) {
      expect(chooseTarget('linear', targets, to)).toEqual({
        project: 't1',
        where: 'ENG · Engineering',
      });
    }
    expect(
      chooseTarget('plane', [{ id: 'p', label: 'WEB · Website' }], 'web', 'acme'),
    ).toHaveProperty('project', 'p');
    expect(
      chooseTarget('github', [{ id: 'acme/web', label: 'acme/web' }], ' ACME/WEB '),
    ).toHaveProperty('project', 'acme/web');
    expect(chooseTarget('linear', targets, 'missing')).toHaveProperty('error', 'no_match');
  });
  it('verifies the key, saves the destination and files a test comment', async () => {
    expect(await runConnect(opts(), deps())).toBe(0);
    expect(requests.map((r) => [r.method, r.url])).toEqual([
      ['GET', API + '/v1/customer/sites'],
      ['POST', API + '/v1/customer/integrations/verify'],
      ['PUT', API + '/v1/customer/sites/s1/integration'],
      ['POST', API + '/v1/customer/sites/s1/test-mark'],
    ]);
    expect(JSON.parse(requests[1]!.body!)).toEqual({ tracker: 'linear', credential: KEY });
    expect(JSON.parse(requests[2]!.body!)).toEqual({
      tracker: 'linear',
      credential: KEY,
      project: 't1',
      projectId: 'p1',
    });
    expect(requests[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(outLines).toEqual([
      'Test comment filed: ENG-1 https://tracker.test/1',
      'Comments from this site go to ENG · Engineering / Web in Linear.',
    ]);
  });
  it('sends the workspace for Plane and the repository for GitHub', async () => {
    success([{ id: 'p', label: 'WEB · Website' }]);
    expect(await runConnect(opts({ tracker: 'plane', workspace: 'acme', to: 'web' }), deps())).toBe(
      0,
    );
    expect(JSON.parse(requests[1]!.body!)).toEqual({
      tracker: 'plane',
      credential: KEY,
      workspace: 'acme',
    });
    expect(JSON.parse(requests[2]!.body!)).toEqual({
      tracker: 'plane',
      credential: KEY,
      workspace: 'acme',
      project: 'p',
    });
    requests = [];
    success([{ id: 'acme/web', label: 'acme/web' }]);
    expect(await runConnect(opts({ tracker: 'github', to: undefined }), deps())).toBe(0);
    expect(JSON.parse(requests[2]!.body!)).toEqual({
      tracker: 'github',
      credential: KEY,
      project: 'acme/web',
    });
  });
  it('sends intake true or false in the Plane destination when asked and nothing when not', async () => {
    const plane = [{ id: 'p', label: 'WEB · Website' }];
    for (const intake of [true, false, undefined]) {
      success(plane);
      requests = [];
      const extra = { tracker: 'plane', workspace: 'acme', to: 'web' } as const;
      expect(
        await runConnect(opts({ ...extra, ...(intake !== undefined && { intake }) }), deps()),
      ).toBe(0);
      expect(JSON.parse(requests[1]!.body!)).not.toHaveProperty('intake');
      const body = JSON.parse(requests[2]!.body!) as Record<string, unknown>;
      if (intake === undefined) expect(body).not.toHaveProperty('intake');
      else expect(body.intake).toBe(intake);
    }
  });
  it('explains a 422 intake_not_enabled on connect', async () => {
    success([{ id: 'p', label: 'WEB · Website' }]);
    replies[2] = { status: 422, body: { code: 'intake_not_enabled' } };
    expect(
      await runConnect(
        opts({ tracker: 'plane', workspace: 'acme', to: 'web', intake: true }),
        deps(),
      ),
    ).toBe(1);
    expect(errLines).toEqual([
      'That Plane project has Intake switched off. In Plane, open the project settings and turn on Intake, then run the command again.',
    ]);
    expect(requests).toHaveLength(3);
  });
  it('finds the site by the project folder name or by --site', async () => {
    expect(await runConnect(opts(), deps())).toBe(0);
    for (const site of ['other', 's2']) {
      success();
      requests = [];
      replies[0] = { status: 200, body: [view('s1', 's2'), view('s2', 'other')] };
      expect(await runConnect(opts({ site }), deps())).toBe(0);
      expect(requests[2]!.url).toBe(API + '/v1/customer/sites/s2/integration');
    }
    success();
    requests = [];
    expect(await runConnect(opts({ site: 'missing' }), deps())).toBe(1);
    expect(errLines.at(-1)).toBe(
      'No site named "missing". Run npx passback init --site first, or pass --site <name>.',
    );
    expect(requests).toHaveLength(1);
  });
  it('says when the tracker rejects the key', async () => {
    replies[1] = { status: 422, body: { code: 'credential_rejected' } };
    expect(await runConnect(opts(), deps())).toBe(1);
    expect(errLines).toEqual(['Linear did not accept that key.']);
    expect(requests).toHaveLength(2);
    success();
    replies[1] = { status: 422, body: { code: 'workspace_not_found' } };
    expect(await runConnect(opts({ tracker: 'plane', workspace: 'acme' }), deps())).toBe(1);
    expect(errLines.at(-1)).toBe('Plane has no workspace "acme" for that key.');
  });
  it('says the destination is saved when the test comment fails', async () => {
    replies[3] = { status: 502, body: { code: 'file_failed' } };
    expect(await runConnect(opts(), deps())).toBe(1);
    expect(errLines).toEqual([
      'The destination is saved, but the test comment could not be filed (file_failed). Run the same command again to retry.',
    ]);
    expect(requests).toHaveLength(4);
    success();
    replies[3] = { status: 409 };
    expect(await runConnect(opts(), deps())).toBe(1);
    expect(errLines.at(-1)).toContain('(409)');
  });
  it('never prints the pasted key or the token, in text or JSON', async () => {
    for (const json of [false, true]) {
      success();
      replies[3] = { status: 200, body: { ref: 'ENG-1' } };
      expect(await runConnect(opts({ json }), deps())).toBe(0);
      if (json)
        expect(JSON.parse(outLines.at(-1)!)).toEqual({
          event: 'connected',
          site: 'shop',
          tracker: 'linear',
          where: 'ENG · Engineering / Web',
          testComment: { ref: 'ENG-1', url: null },
        });
      success();
      replies[1] = { status: 422, body: { code: 'credential_rejected', message: KEY + TOKEN } };
      expect(await runConnect(opts({ json }), deps())).toBe(1);
    }
    for (const line of [...outLines, ...errLines]) {
      expect(line).not.toContain(KEY);
      expect(line).not.toContain(TOKEN);
    }
  });
});
