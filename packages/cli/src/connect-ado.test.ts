import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountDeps } from './account';
import { runConnect, type ConnectOptions } from './connect';
import { writeCredentials } from './credentials';
import type { HostedDeps } from './hosted';

const API = 'https://api.example.test';
const shop = { id: 'p-1', label: 'Shop' };
const docs = { id: 'p-2', label: 'Docs' };
type Recorded = { method: string; url: string; body?: string };
type Reply = { status: number; body?: unknown };
const site = { siteId: 's1', name: 'shop', origins: [], snippet: '<script></script>' };

describe('connect azure-devops', () => {
  let dir: string;
  let requests: Recorded[];
  let errLines: string[];
  let replies: Reply[];

  function deps(): HostedDeps & AccountDeps {
    return {
      credentialsPath: path.join(dir, 'credentials.json'),
      out: () => {},
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
      tracker: 'azure-devops',
      key: 'ado-secret',
      workspace: 'acme',
      json: false,
      ...extra,
    };
  }
  function answers(targets: unknown[], ...rest: Reply[]): void {
    replies = [
      { status: 200, body: [site] },
      { status: 200, body: { account: 'acme', targets } },
      ...rest,
    ];
  }
  const saved: Reply = { status: 200, body: site };
  const comment: Reply = { status: 200, body: { ref: 'Shop#1', url: 'https://dev.azure.com/1' } };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-connect-ado-'));
    requests = [];
    errLines = [];
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: 'pbt_token',
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('verifies with the organization and the token, then saves the project id and the work item type', async () => {
    answers([shop], saved, comment);
    expect(await runConnect(opts({ workItemType: 'Bug' }), deps())).toBe(0);
    expect(JSON.parse(requests[1]!.body!)).toEqual({
      tracker: 'azure-devops',
      credential: 'ado-secret',
      workspace: 'acme',
    });
    expect(requests[2]!.method).toBe('PUT');
    expect(JSON.parse(requests[2]!.body!)).toEqual({
      tracker: 'azure-devops',
      credential: 'ado-secret',
      workspace: 'acme',
      project: 'p-1',
      workItemType: 'Bug',
    });
  });

  it('picks the only project without --to and lists the projects when there are several', async () => {
    answers([shop], saved, comment);
    expect(await runConnect(opts(), deps())).toBe(0);
    expect(JSON.parse(requests[2]!.body!).project).toBe('p-1');

    requests = [];
    answers([shop, docs]);
    expect(await runConnect(opts(), deps())).toBe(1);
    expect(requests).toHaveLength(2);
    expect(errLines).toEqual([
      'Pick where comments go with --to. Choices:',
      '  acme / Shop',
      '  acme / Docs',
    ]);
  });

  it('matches --to by project name, case-insensitively', async () => {
    answers([shop, docs], saved, comment);
    expect(await runConnect(opts({ to: 'dOcS' }), deps())).toBe(0);
    expect(JSON.parse(requests[2]!.body!).project).toBe('p-2');
  });

  it('files Task when no --type is given', async () => {
    answers([shop], saved, comment);
    expect(await runConnect(opts(), deps())).toBe(0);
    expect(JSON.parse(requests[2]!.body!)).not.toHaveProperty('workItemType');
  });

  it('says Azure DevOps has no such organization when the verify answer says so', async () => {
    replies = [
      { status: 200, body: [site] },
      { status: 422, body: { code: 'workspace_not_found' } },
    ];
    expect(await runConnect(opts({ workspace: 'nope' }), deps())).toBe(1);
    expect(errLines.join('\n')).toContain(
      'Azure DevOps has no organization "nope" for that token.',
    );
  });

  it('says the token cannot see the project or the type when the save answer says so', async () => {
    answers([shop], { status: 400, body: { code: 'target_not_visible' } });
    expect(await runConnect(opts(), deps())).toBe(1);
    expect(errLines.join('\n')).toContain('Azure DevOps no longer shows acme / Shop to that key.');
    expect(requests).toHaveLength(3);
  });
});
