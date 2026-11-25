import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runConnectBrowser, type ConnectBrowserDeps } from './connect-browser';
import { writeCredentials } from './credentials';

const HANDLE = 'pbc_handle_value';
const API = 'https://api.example.test';
const URL_ = 'https://auth.atlassian.com/authorize?state=x';
type Recorded = { method: string; url: string; body?: string };
type Reply = { status: number; body?: unknown };
const view = { siteId: 's1', name: 'shop', origins: [], snippet: '<script></script>' };

describe('connect Jira in the browser', () => {
  let dir: string;
  let requests: Recorded[];
  let outLines: string[];
  let errLines: string[];
  let replies: Reply[];

  function deps(): ConnectBrowserDeps {
    return {
      credentialsPath: path.join(dir, 'credentials.json'),
      out: (line) => outLines.push(line),
      err: (line) => errLines.push(line),
      sleep: async () => {},
      openUrl: () => {},
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
  const run = () =>
    runConnectBrowser({ root: path.join(dir, 'shop'), tracker: 'jira', json: false }, deps());
  const sites = { status: 200, body: [view] };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-connect-jira-'));
    requests = [];
    outLines = [];
    errLines = [];
    replies = [];
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: 'pbt_secret_token_value',
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('approves Jira in the browser, saves the chosen site and project and files the test comment', async () => {
    replies = [
      sites,
      { status: 200, body: { url: URL_, handle: HANDLE } },
      { status: 200, body: { state: 'ready', tracker: 'jira' } },
      sites,
      {
        status: 200,
        body: {
          account: 'Acme',
          targets: [
            { id: 'cloud-1', label: 'Acme', children: [{ id: 'ENG', label: 'ENG · Eng' }] },
          ],
        },
      },
      { status: 200, body: view },
      { status: 200, body: { ref: 'ENG-1', url: 'https://acme.atlassian.net/browse/ENG-1' } },
    ];
    expect(await run()).toBe(0);
    expect(requests[1]!.url).toBe(`${API}/v1/customer/sites/s1/connect/jira?from=cli`);
    expect(JSON.parse(requests[5]!.body!)).toEqual({
      tracker: 'jira',
      credential: HANDLE,
      cloudId: 'cloud-1',
      project: 'ENG',
    });
    expect(requests.at(-1)!.url).toBe(`${API}/v1/customer/sites/s1/test-mark`);
    expect(outLines.at(-1)).toBe('Comments from this site go to Acme / ENG · Eng in Jira.');
  });

  it('names Atlassian in the approval line and fails with the Jira wording when Passback has no Jira app', async () => {
    replies = [
      sites,
      { status: 200, body: { url: URL_, handle: HANDLE } },
      { status: 200, body: { state: 'denied' } },
    ];
    await run();
    expect(outLines[0]).toBe(`Approve Passback in Atlassian: ${URL_}`);
    outLines = [];
    errLines = [];
    replies = [sites, { status: 503, body: { code: 'unavailable' } }];
    expect(await run()).toBe(1);
    expect(errLines).toEqual([`Connecting Jira in the browser is not set up on ${API}.`]);
    expect(outLines).toEqual([]);
  });
});
