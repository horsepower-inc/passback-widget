import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeCredentials } from './credentials';
import type { HostedDeps } from './hosted';
import { runConnect, type ConnectOptions } from './connect';

const TOKEN = 'pbt_secret_token_value';
const KEY = 'pk_pasted_clickup_token';
const API = 'https://api.example.test';
const lists = [
  { id: '901', label: 'Product / Web / Bugs' },
  { id: '902', label: 'Product / Web / Tasks' },
];
type Recorded = { method: string; url: string; body?: string };
type Reply = { status: number; body?: unknown };
function view(siteId: string, name: string) {
  return { siteId, name, origins: [], snippet: '<script></script>' };
}

describe('connect clickup', () => {
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
      tracker: 'clickup',
      key: KEY,
      to: 'Product / Web / Bugs',
      json: false,
      ...extra,
    };
  }
  function verified(reply: Reply): void {
    replies = [{ status: 200, body: [view('s1', 'shop')] }, reply];
  }
  function success(visible = lists): void {
    replies = [
      { status: 200, body: [view('s1', 'shop')] },
      { status: 200, body: { account: 'ACME', targets: visible } },
      { status: 200, body: view('s1', 'shop') },
      { status: 200, body: { ref: '86abc', url: 'https://app.clickup.com/t/86abc' } },
    ];
  }
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-connect-clickup-'));
    requests = [];
    outLines = [];
    errLines = [];
    success();
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: TOKEN,
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sends the token alone to verify and saves the picked list id', async () => {
    expect(await runConnect(opts(), deps())).toBe(0);
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET ${API}/v1/customer/sites`,
      `POST ${API}/v1/customer/integrations/verify`,
      `PUT ${API}/v1/customer/sites/s1/integration`,
      `POST ${API}/v1/customer/sites/s1/test-mark`,
    ]);
    expect(JSON.parse(requests[1]!.body!)).toEqual({ tracker: 'clickup', credential: KEY });
    expect(JSON.parse(requests[2]!.body!)).toEqual({
      tracker: 'clickup',
      credential: KEY,
      project: '901',
    });
    expect(outLines).toContain('Comments from this site go to Product / Web / Bugs in ClickUp.');
  });

  it('matches --to by the list label or by the list id', async () => {
    expect(await runConnect(opts({ to: 'product / web / tasks' }), deps())).toBe(0);
    expect(JSON.parse(requests[2]!.body!).project).toBe('902');
    requests = [];
    success();
    expect(await runConnect(opts({ to: '901' }), deps())).toBe(0);
    expect(JSON.parse(requests[2]!.body!).project).toBe('901');
  });

  it('names ClickUp in a rejected-token and an unreachable message', async () => {
    verified({ status: 422, body: { code: 'credential_rejected' } });
    expect(await runConnect(opts(), deps())).toBe(1);
    expect(errLines).toEqual(['ClickUp did not accept that key.']);
    errLines = [];
    verified({ status: 502, body: { code: 'unreachable' } });
    expect(await runConnect(opts(), deps())).toBe(1);
    expect(errLines).toEqual(['ClickUp could not be reached. Try again in a minute.']);
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
  });

  it('asks for --to when the token reaches several lists', async () => {
    expect(await runConnect(opts({ to: undefined }), deps())).toBe(1);
    expect(errLines).toEqual([
      'Pick where comments go with --to. Choices:',
      '  Product / Web / Bugs',
      '  Product / Web / Tasks',
    ]);
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
  });
});
