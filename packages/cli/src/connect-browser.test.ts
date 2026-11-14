import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POLL_MS, WAIT_MS, runConnectBrowser, type ConnectBrowserDeps } from './connect-browser';
import { writeCredentials } from './credentials';

const TOKEN = 'pbt_secret_token_value';
const HANDLE = 'pbc_handle_value';
const API = 'https://api.example.test';
const URL_ = 'https://linear.app/oauth/authorize?state=x';
const targets = [{ id: 't1', label: 'ENG · Engineering' }];
type Recorded = { method: string; url: string; headers: Record<string, string>; body?: string };
type Reply = { status: number; body?: unknown };
function view(siteId: string, name: string) {
  return { siteId, name, origins: [], snippet: '<script></script>' };
}

describe('connect in the browser', () => {
  let dir: string;
  let requests: Recorded[];
  let outLines: string[];
  let errLines: string[];
  let replies: Reply[];
  let slept: number[];
  let opened: string[];

  function deps(): ConnectBrowserDeps {
    return {
      credentialsPath: path.join(dir, 'credentials.json'),
      out: (line) => outLines.push(line),
      err: (line) => errLines.push(line),
      sleep: async (ms) => {
        slept.push(ms);
      },
      openUrl: (url) => opened.push(url),
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
  const run = (json = false, tracker: 'linear' | 'github' = 'linear') =>
    runConnectBrowser({ root: path.join(dir, 'shop'), tracker, json }, deps());
  const sites = { status: 200, body: [view('s1', 'shop')] };
  const started = { status: 200, body: { url: URL_, handle: HANDLE } };
  const waiting = { status: 200, body: { state: 'waiting', tracker: 'linear' } };
  const ready = { status: 200, body: { state: 'ready', tracker: 'linear' } };
  const finish = [
    sites,
    { status: 200, body: { account: 'ACME', targets } },
    { status: 200, body: view('s1', 'shop') },
    { status: 200, body: { ref: 'ENG-1', url: 'https://tracker.test/1' } },
  ];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-connect-browser-'));
    requests = [];
    outLines = [];
    errLines = [];
    replies = [];
    slept = [];
    opened = [];
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: TOKEN,
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('starts the connection, opens the approval address and saves once it is approved', async () => {
    replies = [sites, started, ready, ...finish];
    expect(await run()).toBe(0);
    expect(requests.map((r) => [r.method, r.url])).toEqual([
      ['GET', API + '/v1/customer/sites'],
      ['POST', API + '/v1/customer/sites/s1/connect/linear?from=cli'],
      ['GET', API + `/v1/customer/connect/flows/${HANDLE}`],
      ['GET', API + '/v1/customer/sites'],
      ['POST', API + '/v1/customer/integrations/verify'],
      ['PUT', API + '/v1/customer/sites/s1/integration'],
      ['POST', API + '/v1/customer/sites/s1/test-mark'],
    ]);
    expect(JSON.parse(requests[4]!.body!)).toEqual({ tracker: 'linear', credential: HANDLE });
    expect(opened).toEqual([URL_]);
    expect(outLines[0]).toBe(`Approve Passback in Linear: ${URL_}`);
    expect(outLines[1]).toBe('Waiting for the approval in your browser…');
    expect(outLines.at(-1)).toBe('Comments from this site go to ENG · Engineering in Linear.');
  });

  it('polls every two seconds while the approval is waiting', async () => {
    replies = [sites, started, waiting, waiting, ready, ...finish];
    expect(await run()).toBe(0);
    expect(POLL_MS).toBe(2000);
    expect(slept).toEqual([2000, 2000, 2000]);
  });

  it('stops with a plain sentence when the approval is cancelled or refused', async () => {
    const cases: [string, string][] = [
      ['denied', 'The connection was cancelled in the browser.'],
      [
        'install_requested',
        'Your GitHub organisation owner has to approve the Passback app first. Run the command again once they have.',
      ],
      [
        'installation_not_yours',
        'Your GitHub account cannot see that installation of the Passback app.',
      ],
      ['exchange_failed', 'Passback could not finish the connection. Run the command again.'],
    ];
    for (const [failure, sentence] of cases) {
      requests = [];
      errLines = [];
      replies = [sites, started, { status: 200, body: { state: 'failed', failure } }];
      expect(await run(false, 'github')).toBe(1);
      expect(errLines).toEqual([sentence]);
      expect(requests).toHaveLength(3);
    }
  });

  it('says to run with --key when the browser approval is not set up on the server', async () => {
    replies = [sites, { status: 503, body: { code: 'unavailable' } }];
    expect(await run()).toBe(1);
    expect(errLines).toEqual([
      `Connecting Linear in the browser is not set up on ${API}. Run the command again with --key <key>.`,
    ]);
    expect(opened).toEqual([]);
  });

  it('stops when the approval expires', async () => {
    replies = [sites, started, { status: 404 }];
    expect(await run()).toBe(1);
    expect(errLines).toEqual(['The approval expired. Run the command again.']);
    errLines = [];
    replies = [sites, started, ...Array.from({ length: WAIT_MS / POLL_MS }, () => waiting)];
    slept = [];
    expect(await run()).toBe(1);
    expect(errLines).toEqual(['The approval expired. Run the command again.']);
    expect(slept.reduce((a, b) => a + b, 0)).toBe(WAIT_MS);
  });

  it('prints one JSON line per event with --json and never the token', async () => {
    replies = [sites, started, ready, ...finish];
    expect(await run(true)).toBe(0);
    const lines = outLines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ event: 'approve', tracker: 'linear', url: URL_ });
    expect(lines[1]).toMatchObject({ event: 'connected', tracker: 'linear' });
    const all = outLines.join('\n') + errLines.join('\n');
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain(HANDLE);
  });
});
