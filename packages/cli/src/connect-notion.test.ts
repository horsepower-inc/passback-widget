import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeCredentials } from './credentials';
import type { HostedDeps } from './hosted';
import { runConnect, type ConnectOptions } from './connect';

const TOKEN = 'pbt_secret_token_value';
const SECRET = 'ntn_pasted_secret_value';
const API = 'https://api.example.test';
const databases = [
  { id: 'ds-bugs', label: 'Bugs' },
  { id: 'ds-tasks', label: 'Tasks' },
];
type Recorded = { method: string; url: string; body?: string };
type Reply = { status: number; body?: unknown };
function view(siteId: string, name: string) {
  return { siteId, name, origins: [], snippet: '<script></script>' };
}

describe('connect notion', () => {
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
      tracker: 'notion',
      key: SECRET,
      to: 'Bugs',
      json: false,
      ...extra,
    };
  }
  function verified(reply: Reply): void {
    replies = [{ status: 200, body: [view('s1', 'shop')] }, reply];
  }
  function success(visible = databases): void {
    replies = [
      { status: 200, body: [view('s1', 'shop')] },
      { status: 200, body: { account: 'ACME', targets: visible } },
      { status: 200, body: view('s1', 'shop') },
      { status: 200, body: { ref: 'Bugs-1', url: 'https://www.notion.so/page' } },
    ];
  }
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-connect-notion-'));
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

  it('sends the secret to verify and saves the picked data source id', async () => {
    expect(await runConnect(opts(), deps())).toBe(0);
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET ${API}/v1/customer/sites`,
      `POST ${API}/v1/customer/integrations/verify`,
      `PUT ${API}/v1/customer/sites/s1/integration`,
      `POST ${API}/v1/customer/sites/s1/test-mark`,
    ]);
    expect(JSON.parse(requests[1]!.body!)).toEqual({ tracker: 'notion', credential: SECRET });
    expect(JSON.parse(requests[2]!.body!)).toEqual({
      tracker: 'notion',
      credential: SECRET,
      project: 'ds-bugs',
    });
    expect(outLines).toContain('Comments from this site go to Bugs in Notion.');
  });

  it('matches --to by the database title or by the data source id', async () => {
    expect(await runConnect(opts({ to: 'tasks' }), deps())).toBe(0);
    expect(JSON.parse(requests[2]!.body!).project).toBe('ds-tasks');
    requests = [];
    success();
    expect(await runConnect(opts({ to: 'ds-bugs' }), deps())).toBe(0);
    expect(JSON.parse(requests[2]!.body!).project).toBe('ds-bugs');
    requests = [];
    errLines = [];
    success();
    expect(await runConnect(opts({ to: undefined }), deps())).toBe(1);
    expect(errLines).toEqual(['Pick where comments go with --to. Choices:', '  Bugs', '  Tasks']);
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
  });

  it('names Notion in a rejected-secret and an unreachable message', async () => {
    verified({ status: 422, body: { code: 'credential_rejected' } });
    expect(await runConnect(opts(), deps())).toBe(1);
    expect(errLines).toEqual(['Notion did not accept that key.']);
    errLines = [];
    verified({ status: 502, body: { code: 'unreachable' } });
    expect(await runConnect(opts(), deps())).toBe(1);
    expect(errLines).toEqual(['Notion could not be reached. Try again in a minute.']);
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
  });

  it('tells a secret that sees no database how to share one', async () => {
    verified({ status: 200, body: { account: 'ACME', targets: [] } });
    expect(await runConnect(opts(), deps())).toBe(1);
    expect(errLines).toEqual([
      'That secret cannot see any database. In Notion, open the database, choose the ••• menu, then Connections, and add your integration.',
    ]);
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
  });
});
