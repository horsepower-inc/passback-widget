import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountDeps } from './account';
import { runConnectEdit, type ConnectEditOptions } from './connect-edit';
import { writeCredentials } from './credentials';

const TOKEN = 'pbt_secret_token_value';
const SECRET = 'clickup_stored_tracker_secret';
const API = 'https://api.example.test';
const BASE = `${API}/v1/customer/sites/s%2F1`;
type Recorded = { method: string; url: string; headers: Record<string, string>; body?: string };
type Reply = { status: number; body?: unknown };
const sites = { status: 200, body: [{ siteId: 's/1', name: 'shop', origins: [], snippet: '' }] };
const bugs = { id: '901', label: 'Product / Web / Bugs' };
const tasks = { id: '902', label: 'Product / Web / Tasks' };
const filed = { status: 200, body: { ref: 'T-1', url: 'https://tracker.test/1' } };

describe('connect clickup --keep-key', () => {
  let dir: string;
  let requests: Recorded[];
  let out: string[];
  let replies: Reply[];

  function deps(): AccountDeps {
    return {
      credentialsPath: path.join(dir, 'credentials.json'),
      out: (line) => out.push(line),
      err: (line) => out.push(line),
      sleep: async () => {
        throw new Error('no browser wait');
      },
      openUrl: () => undefined,
      hostname: 'test',
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
  function run(extra: Partial<ConnectEditOptions> = {}): Promise<number> {
    out = [];
    requests = [];
    const opts = { root: path.join(dir, 'shop'), tracker: 'clickup', site: 's/1', json: false };
    return runConnectEdit({ ...opts, ...extra } as ConnectEditOptions, deps());
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-connect-edit-clickup-'));
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: TOKEN,
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('connect clickup --keep-key verifies with the stored token and PATCHes a credential-free list', async () => {
    const verified = { status: 200, body: { targets: [bugs], credential: SECRET } };
    replies = [sites, verified, { status: 200, body: {} }, filed];
    expect(await run()).toBe(0);
    expect(requests.map((r) => [r.method, r.url])).toEqual([
      ['GET', `${API}/v1/customer/sites`],
      ['POST', `${BASE}/integration/verify`],
      ['PATCH', `${BASE}/integration`],
      ['POST', `${BASE}/test-mark`],
    ]);
    expect(JSON.parse(requests[2]!.body!)).toEqual({ tracker: 'clickup', project: '901' });
    expect(JSON.stringify(requests)).not.toContain(SECRET);
  });

  it('connect clickup --keep-key picks the list named with --to', async () => {
    const verified = { status: 200, body: { targets: [bugs, tasks], credential: SECRET } };
    replies = [sites, verified, { status: 200, body: {} }, filed];
    expect(await run({ to: 'Product / Web / Tasks' })).toBe(0);
    expect(JSON.parse(requests[2]!.body!)).toEqual({ tracker: 'clickup', project: '902' });
  });
});
