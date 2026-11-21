import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeCredentials } from './credentials';
import type { HostedDeps } from './hosted';
import { runConnect, type ConnectOptions } from './connect';

const API = 'https://api.example.test';
const targets = [
  {
    id: 'b1',
    label: 'Web',
    children: [
      { id: 'l1', label: 'Todo' },
      { id: 'l2', label: 'Done' },
    ],
  },
];
type Recorded = { method: string; url: string; body?: string };
type Reply = { status: number; body?: unknown };
const site = { siteId: 's1', name: 'shop', origins: [], snippet: '<script></script>' };

describe('connect trello', () => {
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
      tracker: 'trello',
      key: 'K:T',
      to: 'web/done',
      json: false,
      ...extra,
    };
  }
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-connect-trello-'));
    requests = [];
    outLines = [];
    errLines = [];
    replies = [
      { status: 200, body: [site] },
      { status: 200, body: { account: 'ACME', targets } },
      { status: 200, body: site },
      { status: 200, body: { ref: 'card1', url: 'https://trello.test/c/1' } },
    ];
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: 'pbt_secret_token_value',
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('verifies the joined key and token, saves the chosen board and list and files the test comment', async () => {
    expect(await runConnect(opts(), deps())).toBe(0);
    expect(requests.map((r) => `${r.method} ${r.url.replace(API, '')}`)).toEqual([
      'GET /v1/customer/sites',
      'POST /v1/customer/integrations/verify',
      'PUT /v1/customer/sites/s1/integration',
      'POST /v1/customer/sites/s1/test-mark',
    ]);
    expect(JSON.parse(requests[1]!.body!)).toEqual({ tracker: 'trello', credential: 'K:T' });
    expect(JSON.parse(requests[2]!.body!)).toEqual({
      tracker: 'trello',
      credential: 'K:T',
      boardId: 'b1',
      project: 'l2',
    });
    expect(outLines.join('\n')).toContain('Comments from this site go to Web / Done in Trello.');
  });
  it('lists the choices when there are several lists and no --to', async () => {
    expect(await runConnect(opts({ to: undefined, json: true }), deps())).toBe(1);
    expect(JSON.parse(outLines[0]!)).toMatchObject({
      event: 'error',
      code: 'pick_target',
      choices: ['Web / Todo', 'Web / Done'],
    });
    expect(requests).toHaveLength(2);
  });
});
