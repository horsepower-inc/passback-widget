import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AccountDeps } from './account';
import { runConnectEdit } from './connect-edit';
import { writeCredentials } from './credentials';

const API = 'https://api.example.test';
type Reply = { status: number; body?: unknown };
type Recorded = { method: string; url: string; body?: string };
const sites = { status: 200, body: [{ siteId: 's/1', name: 'shop', origins: [], snippet: '' }] };
const found = {
  status: 200,
  body: { targets: [{ id: 'pl1', label: 'WEB · Website' }], credential: 'stored' },
};
const ok = { status: 200, body: {} };
const filed = { status: 200, body: { ref: 'T-1', url: 'https://tracker.test/1' } };

describe('connect --keep-key intake', () => {
  let dir: string;
  let requests: Recorded[];
  let err: string[];
  let replies: Reply[];

  function deps(): AccountDeps {
    return {
      credentialsPath: path.join(dir, 'credentials.json'),
      out: () => undefined,
      err: (line) => err.push(line),
      sleep: async () => undefined,
      openUrl: () => undefined,
      hostname: 'test',
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
  function run(intake?: boolean): Promise<number> {
    requests = [];
    err = [];
    const opts = {
      root: path.join(dir, 'shop'),
      tracker: 'plane' as const,
      site: 's/1',
      json: false,
      ...(intake !== undefined && { intake }),
    };
    return runConnectEdit(opts, deps());
  }
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-connect-edit-intake-'));
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: 'pbt_secret_token_value',
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sends intake with the Plane target when asked and leaves it out otherwise', async () => {
    for (const intake of [true, false, undefined]) {
      replies = [sites, found, ok, filed];
      expect(await run(intake)).toBe(0);
      const patch = requests[2]!;
      expect(patch.method).toBe('PATCH');
      expect(JSON.parse(patch.body!)).toEqual({
        tracker: 'plane',
        project: 'pl1',
        ...(intake !== undefined && { intake }),
      });
    }
  });

  it('explains a 422 intake_not_enabled on --keep-key', async () => {
    replies = [sites, found, { status: 422, body: { code: 'intake_not_enabled' } }];
    expect(await run(true)).toBe(1);
    expect(err).toEqual([
      'That Plane project has Intake switched off. In Plane, open the project settings and turn on Intake, then run the command again.',
    ]);
    expect(requests).toHaveLength(3);
  });
});
