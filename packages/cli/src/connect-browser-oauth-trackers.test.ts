import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountDeps } from './account';
import { connectCommand } from './connect-command';
import { writeCredentials } from './credentials';

const TOKEN = 'pbt_secret_token_value';
const HANDLE = 'pbc_handle_value';
const PASTED = 'glpat-pasted-token-value';
const API = 'https://api.example.test';
type Recorded = { method: string; url: string; body?: string };
type Reply = { status: number; body?: unknown };
type Connect = Parameters<typeof connectCommand>[0];

function view(siteId: string, name: string) {
  return { siteId, name, origins: [], snippet: '<script></script>' };
}

describe('connect gitlab, notion and clickup in the browser', () => {
  let dir: string;
  let requests: Recorded[];
  let outLines: string[];
  let opened: string[];
  let replies: Reply[];
  let exitCode: typeof process.exitCode;

  function deps(): AccountDeps {
    return {
      credentialsPath: path.join(dir, 'credentials.json'),
      out: (line: string) => outLines.push(line),
      err: (line: string) => outLines.push(line),
      sleep: async () => undefined,
      openUrl: (url: string) => opened.push(url),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          method: init?.method ?? 'GET',
          url: String(input),
          body: init?.body as string | undefined,
        });
        const reply = replies.shift() ?? { status: 404 };
        return new Response(JSON.stringify(reply.body), { status: reply.status });
      }) as typeof fetch,
    } as unknown as AccountDeps;
  }
  const sites = { status: 200, body: [view('s1', 'shop')] };
  const approvalUrl = (tracker: string) => `https://${tracker}.example.test/approve?state=x`;
  function flow(tracker: string, targets: unknown[]): Reply[] {
    return [
      sites,
      { status: 200, body: { url: approvalUrl(tracker), handle: HANDLE } },
      { status: 200, body: { state: 'ready', tracker } },
      sites,
      { status: 200, body: { account: 'ACME', targets } },
      { status: 200, body: view('s1', 'shop') },
      { status: 200, body: { ref: 'T-1', url: 'https://tracker.test/1' } },
    ];
  }
  function args(extra: Record<string, unknown>): Connect {
    return { cmd: 'connect', site: 'shop', json: false, ...extra } as Connect;
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-connect-oauth-'));
    requests = [];
    outLines = [];
    opened = [];
    replies = [];
    exitCode = process.exitCode;
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: TOKEN,
    });
  });
  afterEach(async () => {
    process.exitCode = exitCode;
    await rm(dir, { recursive: true, force: true });
  });

  it('connect gitlab without a key or url approves in the browser and saves the chosen project', async () => {
    replies = flow('gitlab', [{ id: 'g1', label: 'acme/shop' }]);
    await connectCommand(args({ tracker: 'gitlab' }), deps());
    expect(process.exitCode).toBe(0);
    expect(requests.map((r) => [r.method, r.url])).toEqual([
      ['GET', API + '/v1/customer/sites'],
      ['POST', API + '/v1/customer/sites/s1/connect/gitlab?from=cli'],
      ['GET', API + `/v1/customer/connect/flows/${HANDLE}`],
      ['GET', API + '/v1/customer/sites'],
      ['POST', API + '/v1/customer/integrations/verify?siteId=s1'],
      ['PUT', API + '/v1/customer/sites/s1/integration'],
      ['POST', API + '/v1/customer/sites/s1/test-mark'],
    ]);
    expect(JSON.parse(requests[4]!.body!)).toEqual({ tracker: 'gitlab', credential: HANDLE });
    expect(JSON.parse(requests[5]!.body!)).toEqual({
      tracker: 'gitlab',
      credential: HANDLE,
      project: 'g1',
    });
    expect(opened).toEqual([approvalUrl('gitlab')]);
    expect(outLines[0]).toBe(`Approve Passback in GitLab: ${approvalUrl('gitlab')}`);
    expect(outLines.at(-1)).toBe('Comments from this site go to acme/shop in GitLab.');
  });

  it('connect notion and connect clickup without a key approve in the browser and save the chosen target', async () => {
    const cases = [
      ['notion', 'Notion', { id: 'ds-bugs', label: 'Bugs' }],
      ['clickup', 'ClickUp', { id: 'l1', label: 'Product / Web / Bugs' }],
    ] as const;
    for (const [tracker, name, target] of cases) {
      requests = [];
      outLines = [];
      opened = [];
      replies = flow(tracker, [target]);
      await connectCommand(args({ tracker }), deps());
      expect(process.exitCode).toBe(0);
      expect(requests[1]!.url).toBe(API + `/v1/customer/sites/s1/connect/${tracker}?from=cli`);
      expect(JSON.parse(requests[5]!.body!)).toEqual({
        tracker,
        credential: HANDLE,
        project: target.id,
      });
      expect(opened).toEqual([approvalUrl(tracker)]);
      expect(outLines[0]).toBe(`Approve Passback in ${name}: ${approvalUrl(tracker)}`);
      expect(outLines.at(-1)).toBe(`Comments from this site go to ${target.label} in ${name}.`);
    }
    // An unconfigured app answers 503: the sentence names --key <token>.
    for (const [tracker, name] of [
      ['gitlab', 'GitLab'],
      ['notion', 'Notion'],
      ['clickup', 'ClickUp'],
    ] as const) {
      outLines = [];
      replies = [sites, { status: 503, body: { code: 'unavailable' } }];
      await connectCommand(args({ tracker }), deps());
      expect(process.exitCode).toBe(1);
      expect(outLines).toEqual([
        `Connecting ${name} in the browser is not set up on ${API}. Run the command again with --key <token>.`,
      ]);
    }
  });

  it('connect gitlab with a self-managed url and a key keeps the pasted token', async () => {
    replies = [
      sites,
      { status: 200, body: { account: 'ACME', targets: [{ id: 'g1', label: 'acme/shop' }] } },
      { status: 200, body: view('s1', 'shop') },
      { status: 200, body: { ref: 'T-1', url: null } },
    ];
    const url = 'https://gitlab.example.test';
    await connectCommand(args({ tracker: 'gitlab', key: PASTED, url }), deps());
    expect(process.exitCode).toBe(0);
    expect(requests.map((r) => r.url)).toEqual([
      API + '/v1/customer/sites',
      API + '/v1/customer/integrations/verify?siteId=s1',
      API + '/v1/customer/sites/s1/integration',
      API + '/v1/customer/sites/s1/test-mark',
    ]);
    expect(JSON.parse(requests[1]!.body!)).toEqual({
      tracker: 'gitlab',
      credential: PASTED,
      gitlabUrl: url,
    });
    expect(opened).toEqual([]);
  });
});
