import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountDeps } from './account';
import { connectCommand } from './connect-command';
import { runConnectEdit, type ConnectEditOptions } from './connect-edit';
import { writeCredentials } from './credentials';

const TOKEN = 'pbt_secret_token_value';
const SECRET = 'lin_api_stored_tracker_secret';
const API = 'https://api.example.test';
const BASE = `${API}/v1/customer/sites/s%2F1`;
type Tracker = ConnectEditOptions['tracker'];
type Target = { id: string; label: string; children?: { id: string; label: string }[] };
type Reply = { status: number; body?: unknown } | 'throw';
type Recorded = { method: string; url: string; headers: Record<string, string>; body?: string };
type Extra = Partial<ConnectEditOptions>;
type Case = { tracker: Tracker; targets: Target[]; where: string; body: object; extra: Extra };
const sites = { status: 200, body: [{ siteId: 's/1', name: 'shop', origins: [], snippet: '' }] };
const found = (targets: Target[]) => ({ status: 200, body: { targets, credential: SECRET } });
const ok = { status: 200, body: {} };
const filed = { status: 200, body: { ref: 'T-1', url: 'https://tracker.test/1' } };
const code = (status: number, value: string) => ({ status, body: { code: value } });
const eng = { id: 't1', label: 'ENG · Eng', children: [{ id: 'p1', label: 'Web' }] };
const plane = [{ id: 'pl1', label: 'WEB · Website' }];
const ado = [{ id: 'a1', label: 'Shop' }];
const jira = [{ id: 'c1', label: 'acme', children: [{ id: 'SHOP', label: 'SHOP · Shop' }] }];
const board = [{ id: 'b1', label: 'Board', children: [{ id: 'l1', label: 'Todo' }] }];
const NAMES: Record<string, string> = {
  linear: 'Linear',
  plane: 'Plane',
  github: 'GitHub',
  jira: 'Jira',
  gitlab: 'GitLab',
  'azure-devops': 'Azure DevOps',
  trello: 'Trello',
  notion: 'Notion',
};
type Row = [Tracker, Target[], string, object, Extra?];
const rows: Row[] = [
  ['linear', [eng], 'ENG · Eng / Web', { project: 't1', projectId: 'p1' }, { to: 'eng/web' }],
  ['linear', [eng], 'ENG · Eng', { project: 't1' }, { to: 'ENG' }],
  ['plane', plane, 'WEB · Website', { project: 'pl1' }],
  ['github', [{ id: 'acme/web', label: 'acme/web' }], 'acme/web', { project: 'acme/web' }],
  ['jira', jira, 'acme / SHOP · Shop', { cloudId: 'c1', project: 'SHOP' }],
  ['azure-devops', ado, 'Shop', { project: 'a1', workItemType: 'Bug' }, { workItemType: 'Bug' }],
  ['azure-devops', ado, 'Shop', { project: 'a1' }],
  ['gitlab', [{ id: 'g1', label: 'acme/shop' }], 'acme/shop', { project: 'g1' }],
  ['trello', board, 'Board / Todo', { boardId: 'b1', project: 'l1' }],
  ['notion', [{ id: 'n1', label: 'Bugs' }], 'Bugs', { project: 'n1' }],
];
const saved: Case[] = rows.map(([tracker, targets, where, body, extra = {}]) => ({
  tracker,
  targets,
  where,
  body,
  extra,
}));
const MESSAGES: Record<string, string> = {
  not_editable: 'This connection cannot be edited this way.',
  no_site: 'No site named "s/1". Run npx passback init --site first, or pass --site <name>.',
  target_not_visible: 'Linear no longer shows ENG · Eng / Web to that key.',
  tracker_unreachable: 'Linear could not be reached. Try again in a minute.',
  signed_out: 'Not signed in. Run npx passback login first.',
  unreachable: `Cannot reach ${API}.`,
  revoked: 'Your sign-in has ended. Run npx passback login.',
  rate_limited: 'Too many tries. Wait a minute and run it again.',
  unavailable: `Hosted Passback is not available on ${API} right now.`,
  test_failed:
    'The destination is saved, but the test comment could not be filed (boom). Run the same command again to retry.',
};
const failing: [Reply[], string, number][] = [
  [[sites, code(409, 'not_editable')], 'not_editable', 2],
  [[sites, found([eng]), code(409, 'not_editable')], 'not_editable', 3],
  [[{ status: 200, body: [] }], 'no_site', 1],
  [[sites, code(404, 'not_found')], 'unexpected', 2],
  [[sites, found([eng]), code(400, 'target_not_visible')], 'target_not_visible', 3],
  [[sites, { status: 502 }], 'tracker_unreachable', 2],
  [[sites, found([eng]), { status: 502 }], 'tracker_unreachable', 3],
  [[], 'signed_out', 0],
  [[sites, 'throw'], 'unreachable', 2],
  [[sites, found([eng]), 'throw'], 'unreachable', 3],
  [[sites, { status: 401 }], 'revoked', 2],
  [[sites, found([eng]), { status: 429 }], 'rate_limited', 3],
  [[sites, { status: 503 }], 'unavailable', 2],
  [[sites, { status: 200, body: { targets: 'x' } }], 'unexpected', 2],
  [[{ status: 200, body: {} }], 'unexpected', 1],
  [[sites, { status: 500 }], 'unexpected', 2],
  [[sites, found([eng]), { status: 500 }], 'unexpected', 3],
  [[sites, found([eng]), ok, code(500, 'boom')], 'test_failed', 4],
];
const messageOf = (replies: Reply[], value: string) =>
  MESSAGES[value] ??
  `Unexpected answer from ${API} (${(replies.at(-1) as { status: number }).status}).`;

describe('connect --keep-key', () => {
  let dir: string;
  let requests: Recorded[];
  let out: string[];
  let err: string[];
  let replies: Reply[];
  let opened: string[];

  function deps(): AccountDeps {
    return {
      credentialsPath: path.join(dir, 'credentials.json'),
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      sleep: async () => {
        throw new Error('no browser wait');
      },
      openUrl: (url) => opened.push(url),
      hostname: 'test',
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          method: init?.method ?? 'GET',
          url: String(input),
          headers: init?.headers as Record<string, string>,
          body: init?.body as string | undefined,
        });
        const reply = replies.shift() ?? { status: 404 };
        if (reply === 'throw') throw new TypeError('fetch failed');
        return new Response(JSON.stringify(reply.body), { status: reply.status });
      }) as typeof fetch,
    };
  }
  function run(tracker: Tracker, extra: Extra = {}, json = false): Promise<number> {
    out = [];
    err = [];
    requests = [];
    const opts = { root: path.join(dir, 'shop'), tracker, site: 's/1', json, ...extra };
    return runConnectEdit(opts, deps());
  }
  const lines = () => out.map((line) => JSON.parse(line) as Record<string, unknown>);
  const signIn = () =>
    writeCredentials(path.join(dir, 'credentials.json'), { v: 1, api: API, accessToken: TOKEN });
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-connect-edit-'));
    opened = [];
    await signIn();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('connect --keep-key verifies with the stored key, saves a credential-free PATCH and files a test comment', async () => {
    const comment = { ref: 'T-1', url: 'https://tracker.test/1' };
    for (const { tracker, targets, where, body, extra } of saved) {
      replies = [sites, found(targets), ok, filed];
      expect(await run(tracker, { ...extra, site: undefined })).toBe(0);
      expect(requests.map((r) => [r.method, r.url, r.body])).toEqual([
        ['GET', `${API}/v1/customer/sites`, undefined],
        ['POST', `${BASE}/integration/verify`, undefined],
        ['PATCH', `${BASE}/integration`, JSON.stringify({ tracker, ...body })],
        ['POST', `${BASE}/test-mark`, undefined],
      ]);
      expect(out).toEqual([
        'Test comment filed: T-1 https://tracker.test/1',
        `Comments from this site go to ${where} in ${NAMES[tracker]}.`,
      ]);
      replies = [sites, found(targets), ok, filed];
      expect(await run(tracker, extra, true)).toBe(0);
      expect(lines()).toEqual([
        { event: 'connected', site: 'shop', tracker, where, testComment: comment },
      ]);
    }
    replies = [sites, found([eng]), ok, { status: 200, body: { ref: 'T-2' } }];
    expect(await run('linear', { to: 'ENG', site: 'shop' })).toBe(0);
    expect(out[0]).toBe('Test comment filed: T-2');
  });

  it('connect --keep-key never opens the browser flow', async () => {
    const before = process.exitCode;
    try {
      for (const { tracker, targets, extra } of saved) {
        replies = [sites, found(targets), ok, filed];
        requests = [];
        const parsed = { cmd: 'connect', tracker, keepKey: true, site: 's/1', json: true } as const;
        await connectCommand({ ...parsed, ...extra }, deps());
        expect(process.exitCode).toBe(0);
        expect(requests.map((r) => r.method)).toEqual(['GET', 'POST', 'PATCH', 'POST']);
        expect(requests.filter((r) => r.url.includes('/connect'))).toEqual([]);
      }
      replies = [sites, code(409, 'tracker_changed')];
      const parsed = { cmd: 'connect', tracker: 'github', keepKey: true, json: false } as const;
      await connectCommand({ ...parsed, site: 's/1' }, deps());
      expect(process.exitCode).toBe(1);
      expect(opened).toEqual([]);
    } finally {
      process.exitCode = before;
    }
  });

  it('connect --keep-key never sends a credential in any request', async () => {
    const forbidden = ['credential', 'key', 'token', 'workspace', 'gitlabUrl', 'url'];
    for (const { tracker, targets, extra } of saved) {
      replies = [sites, found(targets), ok, filed];
      expect(await run(tracker, extra, true)).toBe(0);
      for (const request of requests) {
        expect(request.headers.authorization).toBe(`Bearer ${TOKEN}`);
        expect(request.body ?? '').not.toContain(SECRET);
      }
      const body = JSON.parse(requests[2]!.body!) as Record<string, unknown>;
      expect(forbidden.filter((field) => field in body)).toEqual([]);
      expect([...out, ...err].join('\n')).not.toContain(SECRET);
      expect([...out, ...err].join('\n')).not.toContain(TOKEN);
    }
  });

  it('connect --keep-key says to run connect with a new key when the saved key is rejected', async () => {
    const message = 'The saved key no longer works. Run passback connect trello with a new key.';
    for (const [answers, calls] of [
      [[sites, code(422, 'credential_rejected')], 2],
      [[sites, found(board), code(422, 'credential_rejected')], 3],
    ] as const) {
      replies = [...answers];
      expect(await run('trello')).toBe(1);
      expect([err, out, requests.length]).toEqual([[message], [], calls]);
      replies = [...answers];
      expect(await run('trello', {}, true)).toBe(1);
      expect(lines()).toEqual([{ event: 'error', code: 'credential_rejected', message }]);
      expect(requests).toHaveLength(calls);
    }
  });

  it('connect --keep-key answers tracker_changed with a message and exit 1', async () => {
    const message = 'This site is connected to another tracker.';
    for (const [answers, calls] of [
      [[sites, code(409, 'tracker_changed')], 2],
      [[sites, found([eng]), code(409, 'tracker_changed')], 3],
    ] as const) {
      replies = [...answers];
      expect(await run('linear', { to: 'ENG' })).toBe(1);
      expect([err, out, requests.length]).toEqual([[message], [], calls]);
      replies = [...answers];
      expect(await run('linear', { to: 'ENG' }, true)).toBe(1);
      expect(lines()).toEqual([{ event: 'error', code: 'tracker_changed', message }]);
      expect(requests).toHaveLength(calls);
    }
  });

  it('connect --keep-key reports selection choices without an undefined workspace', async () => {
    const pick = 'Pick where comments go with --to. Choices:';
    for (const [tracker, two, alias, where, other] of [
      [
        'plane',
        [...plane, { id: 'pl2', label: 'API · Backend' }],
        'web',
        'WEB · Website',
        'API · Backend',
      ],
      ['azure-devops', [...ado, { id: 'a2', label: 'Api' }], 'shop', 'Shop', 'Api'],
    ] as const) {
      replies = [sites, found([...two]), ok, filed];
      expect(await run(tracker, { to: alias }, true)).toBe(0);
      expect(lines()[0]).toMatchObject({ event: 'connected', where });
      for (const [to, error] of [
        [undefined, 'pick_target'],
        ['nope', 'no_match'],
      ] as const) {
        replies = [sites, found([...two])];
        expect(await run(tracker, { to })).toBe(1);
        expect([err, requests.length]).toEqual([[pick, `  ${where}`, `  ${other}`], 2]);
        replies = [sites, found([...two])];
        expect(await run(tracker, { to }, true)).toBe(1);
        const choices = [where, other];
        expect(lines()).toEqual([{ event: 'error', code: error, message: pick, choices }]);
      }
      expect([...out, ...err].join('\n')).not.toContain('undefined');
    }
    for (const [tracker, message] of [
      ['plane', 'That key cannot see any team, project or repository.'],
      [
        'notion',
        'That secret cannot see any database. In Notion, open the database, choose the ••• menu, then Connections, and add your integration.',
      ],
    ] as const) {
      replies = [sites, found([])];
      expect(await run(tracker, {}, true)).toBe(1);
      const failure = { event: 'error', code: 'no_targets', message };
      expect([lines(), requests.length]).toEqual([[failure], 2]);
    }
  });

  it('connect --keep-key stops on failures and preserves existing failure reports', async () => {
    for (const [answers, value, calls] of failing) {
      const message = messageOf(answers, value);
      if (value === 'signed_out') await rm(path.join(dir, 'credentials.json'));
      replies = [...answers];
      expect(await run('linear', { to: 'eng/web' })).toBe(1);
      expect([err, out, requests.length]).toEqual([[message], [], calls]);
      replies = [...answers];
      expect(await run('linear', { to: 'eng/web' }, true)).toBe(1);
      const failure = { event: 'error', code: value, message };
      expect([lines(), requests.length]).toEqual([[failure], calls]);
      await signIn();
    }
  });
});
