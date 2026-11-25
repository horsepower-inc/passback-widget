import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseConnect } from './args-connect';
import { parseArgs } from './args';
import { runConnectBrowser, type ConnectBrowserDeps } from './connect-browser';
import { runConnectEdit } from './connect-edit';
import { writeCredentials } from './credentials';
import { usageMessage } from './usage-message';

const HANDLE = 'pbc_handle_value';
const API = 'https://api.example.test';
const URL_ = 'https://auth.atlassian.com/authorize?state=x';
type Recorded = { method: string; url: string; body?: string };
type Reply = { status: number; body?: unknown };
const view = { siteId: 's1', name: 'shop', origins: [], snippet: '<script></script>' };
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

describe('connect Trello in the browser', () => {
  let dir: string;
  let requests: Recorded[];
  let outLines: string[];
  let errLines: string[];
  let opened: string[];
  let replies: Reply[];

  function deps(): ConnectBrowserDeps {
    return {
      credentialsPath: path.join(dir, 'credentials.json'),
      out: (line) => outLines.push(line),
      err: (line) => errLines.push(line),
      sleep: async () => {},
      openUrl: (url) => {
        opened.push(url);
      },
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
  const run = (to?: string) =>
    runConnectBrowser(
      { root: path.join(dir, 'shop'), tracker: 'trello', json: false, ...(to && { to }) },
      deps(),
    );
  const sites = { status: 200, body: [view] };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-connect-trello-browser-'));
    requests = [];
    outLines = [];
    errLines = [];
    opened = [];
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

  it('connect trello without a key approves in the browser and saves the chosen board and list', async () => {
    replies = [
      sites,
      { status: 200, body: { url: URL_, handle: HANDLE } },
      { status: 200, body: { state: 'waiting' } },
      { status: 200, body: { state: 'ready', tracker: 'trello' } },
      sites,
      { status: 200, body: { account: 'Acme', targets } },
      { status: 200, body: view },
      { status: 200, body: { ref: 'c1', url: 'https://trello.test/c/1' } },
    ];
    expect(await run('web/done')).toBe(0);
    expect(requests[1]!.method).toBe('POST');
    expect(requests[1]!.url).toBe(`${API}/v1/customer/sites/s1/connect/trello?from=cli`);
    expect(outLines[0]).toBe(`Approve Passback in Atlassian: ${URL_}`);
    expect(opened).toEqual([URL_]);
    expect(requests[2]!.url).toBe(`${API}/v1/customer/connect/flows/${HANDLE}`);
    expect(JSON.parse(requests[6]!.body!)).toEqual({
      tracker: 'trello',
      credential: HANDLE,
      boardId: 'b1',
      project: 'l2',
    });
    expect(outLines.at(-1)).toBe('Comments from this site go to Web / Done in Trello.');
  });

  it('connect trello with --key or --token exits 2 and says Trello connects through the Passback app', () => {
    const message =
      'passback: Trello connects through the Passback app: run passback connect trello without --key and --token.';
    for (const args of [
      ['--key', 'K'],
      ['--token', 'T'],
      ['--key', 'K', '--token', 'T'],
      ['--key'],
      ['--token'],
      ['--keep-key', '--key', 'K'],
      ['--keep-key', '--token', 'T'],
      ['--token', 'T', '--keep-key'],
    ]) {
      const parsed = parseArgs(['connect', 'trello', ...args]);
      expect(parsed).toMatchObject({ cmd: 'usage' });
      expect(usageMessage((parsed as { error: string }).error)).toBe(message);
    }
  });

  it('connect trello says browser approval is not set up when the server answers 503', async () => {
    replies = [sites, { status: 503, body: { code: 'unavailable' } }];
    expect(await run()).toBe(1);
    expect(errLines).toEqual([`Connecting Trello in the browser is not set up on ${API}.`]);
    expect(opened).toEqual([]);
  });

  it('connect trello --keep-key keeps working for a site connected with a key and token', async () => {
    expect(parseConnect(['trello', '--keep-key', '--to', 'web/done'])).toEqual({
      cmd: 'connect',
      tracker: 'trello',
      to: 'web/done',
      keepKey: true,
      json: false,
    });
    replies = [
      sites,
      { status: 200, body: { targets, credential: 'K:T' } },
      { status: 200, body: {} },
      { status: 200, body: { ref: 'c1', url: 'https://trello.test/c/1' } },
    ];
    const code = await runConnectEdit(
      { root: path.join(dir, 'shop'), tracker: 'trello', to: 'web/done', json: false },
      deps(),
    );
    expect(code).toBe(0);
    expect(outLines.join('\n')).toContain('Web / Done in Trello');
  });
});
