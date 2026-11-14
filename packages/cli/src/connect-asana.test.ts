import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chooseTarget, runConnect, type ConnectOptions, type Target } from './connect';
import { asanaBody, asanaChoices } from './connect-asana';
import { writeCredentials } from './credentials';
import type { HostedDeps } from './hosted';

const KEY = 'asana_secret_token_value';
const targets: Target[] = [
  {
    id: 'ws-1',
    label: 'Acme',
    children: [
      { id: 'p-1', label: 'Website' },
      { id: 'p-2', label: 'Mobile' },
    ],
  },
  { id: 'ws-2', label: 'Beta', children: [{ id: 'p-3', label: 'Docs' }] },
];

describe('Asana choices', () => {
  it('lists each project of each workspace as a choice named workspace / project', () => {
    expect(asanaChoices(targets)).toEqual([
      { project: 'ws-1', projectId: 'p-1', where: 'Acme / Website' },
      { project: 'ws-1', projectId: 'p-2', where: 'Acme / Mobile' },
      { project: 'ws-2', projectId: 'p-3', where: 'Beta / Docs' },
    ]);
  });

  it('matches --to by project name, by workspace and project, by project gid or by the full name', () => {
    const expected = { project: 'ws-1', projectId: 'p-2', where: 'Acme / Mobile' };
    expect(chooseTarget('asana', targets, 'mobile')).toEqual(expected);
    expect(chooseTarget('asana', targets, 'Acme/Mobile')).toEqual(expected);
    expect(chooseTarget('asana', targets, 'p-2')).toEqual(expected);
    expect(chooseTarget('asana', targets, 'Acme / Mobile')).toEqual(expected);
    expect(chooseTarget('asana', targets, 'nope')).toMatchObject({ error: 'no_match' });
  });

  it('picks the only project without --to and asks for --to when there are several', () => {
    expect(chooseTarget('asana', [targets[1]!], undefined)).toEqual({
      project: 'ws-2',
      projectId: 'p-3',
      where: 'Beta / Docs',
    });
    expect(chooseTarget('asana', targets, undefined)).toMatchObject({ error: 'pick_target' });
  });

  it('builds the Asana save body with the workspace gid and the project gid', () => {
    expect(asanaBody('tok', { project: 'ws-1', projectId: 'p-1', where: 'w' })).toEqual({
      tracker: 'asana',
      credential: 'tok',
      workspace: 'ws-1',
      project: 'p-1',
    });
  });
});

describe('connect asana', () => {
  let dir: string;
  let requests: { method: string; url: string; body?: string }[];
  let replies: { status: number; body?: unknown }[];

  function deps(): HostedDeps {
    return {
      credentialsPath: path.join(dir, 'credentials.json'),
      out: () => {},
      err: () => {},
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

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-connect-asana-'));
    requests = [];
    const site = { siteId: 's1', name: 'shop', origins: [], snippet: '<script></script>' };
    replies = [
      { status: 200, body: [site] },
      { status: 200, body: { account: 'Acme', targets } },
      { status: 200, body: site },
      { status: 200, body: { ref: 'T-1', url: 'https://app.asana.test/1' } },
    ];
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: 'https://api.example.test',
      accessToken: 'pbt_token',
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sends the token to verify, saves the picked project and never uses the browser flow', async () => {
    const opts: ConnectOptions = {
      root: path.join(dir, 'shop'),
      tracker: 'asana',
      key: KEY,
      to: 'Acme/Website',
      json: false,
    };
    expect(await runConnect(opts, deps())).toBe(0);
    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      'GET /v1/customer/sites',
      'POST /v1/customer/integrations/verify',
      'PUT /v1/customer/sites/s1/integration',
      'POST /v1/customer/sites/s1/test-mark',
    ]);
    expect(JSON.parse(requests[1]!.body!)).toEqual({ tracker: 'asana', credential: KEY });
    expect(JSON.parse(requests[2]!.body!)).toEqual({
      tracker: 'asana',
      credential: KEY,
      workspace: 'ws-1',
      project: 'p-1',
    });
  });
});
