import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeCredentials } from './credentials';
import { runSiteDelete, type SiteDeleteDeps } from './site-delete';

const TOKEN = 'pbt_secret_token_value';
const API = 'https://api.example.test';
type Recorded = { method: string; url: string; headers: Record<string, string> };
type Reply = { status: number; body?: unknown };

function view(siteId: string, name: string) {
  return {
    siteId,
    name,
    origins: ['http://localhost:3000'],
    snippet: `<script data-passback-endpoint="https://ingest.example.test/v1/ingest/${siteId}"></script>`,
  };
}

describe('site delete', () => {
  let dir: string;
  let requests: Recorded[];
  let outLines: string[];
  let errLines: string[];
  let replies: { GET: Reply; DELETE: Reply };

  function deps(): SiteDeleteDeps {
    return {
      credentialsPath: path.join(dir, 'credentials.json'),
      out: (line) => outLines.push(line),
      err: (line) => errLines.push(line),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        requests.push({
          method,
          url: String(input),
          headers: init?.headers as Record<string, string>,
        });
        const reply = replies[method as 'GET' | 'DELETE'];
        return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
          status: reply.status,
        });
      }) as typeof fetch,
    };
  }

  const deletes = (): Recorded[] => requests.filter((r) => r.method === 'DELETE');
  const opts = { name: 'my-app', yes: false, json: false };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-site-delete-'));
    requests = [];
    outLines = [];
    errLines = [];
    replies = { GET: { status: 200, body: [view('pb_a', 'my-app')] }, DELETE: { status: 204 } };
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: TOKEN,
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('deletes the named site after the typed name matches', async () => {
    const ask = vi.fn(async () => ' my-app ');
    expect(await runSiteDelete(opts, { ...deps(), ask })).toBe(0);
    expect(ask).toHaveBeenCalledWith('Type the site name (my-app) to delete it: ');
    expect(deletes()).toEqual([
      {
        method: 'DELETE',
        url: `${API}/v1/customer/sites/pb_a`,
        headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json' },
      },
    ]);
    expect(outLines).toEqual([
      'Deleted site "my-app" (pb_a). Its site key stops working and its tracker connection is removed. Comments already filed stay in the tracker.',
    ]);
    expect(errLines).toEqual([]);
  });

  it('deletes without a prompt when --yes is given', async () => {
    const ask = vi.fn(async () => 'wrong');
    expect(await runSiteDelete({ ...opts, yes: true }, { ...deps(), ask })).toBe(0);
    expect(ask).not.toHaveBeenCalled();
    expect(deletes()).toHaveLength(1);
  });

  it('deletes nothing when the typed name does not match', async () => {
    expect(await runSiteDelete(opts, { ...deps(), ask: async () => 'My-app' })).toBe(1);
    expect(errLines).toEqual(['The name did not match. Nothing was deleted.']);
    expect(deletes()).toHaveLength(0);
  });

  it('asks for --yes when there is no terminal to type in', async () => {
    expect(await runSiteDelete({ ...opts, json: true }, deps())).toBe(1);
    expect(JSON.parse(outLines[0] as string)).toEqual({
      event: 'error',
      code: 'confirm_needed',
      message:
        'Nothing was deleted. To delete without a prompt, run: npx passback site delete "my-app" --yes',
    });
    expect(deletes()).toHaveLength(0);
  });

  it('accepts the site key in place of the name', async () => {
    replies.GET.body = [view('pb_a', 'my-app'), view('pb_b', 'pb_a')];
    const ask = vi.fn(async () => 'my-app');
    expect(await runSiteDelete({ ...opts, name: 'pb_a' }, { ...deps(), ask })).toBe(0);
    expect(ask).toHaveBeenCalledWith('Type the site name (my-app) to delete it: ');
    expect(deletes()[0]?.url).toBe(`${API}/v1/customer/sites/pb_a`);
  });

  it('refuses a name two sites share and lists their keys', async () => {
    replies.GET.body = [view('pb_a', 'my-app'), view('pb_b', 'my-app')];
    expect(await runSiteDelete({ ...opts, yes: true }, deps())).toBe(1);
    expect(errLines).toEqual([
      '2 sites are named "my-app". Pass the site key instead: pb_a, pb_b.',
    ]);
    expect(deletes()).toHaveLength(0);
  });

  it('says when no site has that name', async () => {
    replies.GET.body = [];
    expect(await runSiteDelete({ ...opts, yes: true }, deps())).toBe(1);
    expect(errLines).toEqual(['No site named "my-app".']);
    expect(deletes()).toHaveLength(0);
  });

  it('prints one JSON line with --json and never the token', async () => {
    expect(await runSiteDelete({ ...opts, yes: true, json: true }, deps())).toBe(0);
    expect(outLines).toHaveLength(1);
    expect(JSON.parse(outLines[0] as string)).toEqual({
      event: 'deleted',
      name: 'my-app',
      siteKey: 'pb_a',
    });
    expect(errLines).toEqual([]);
    expect([...outLines, ...errLines].join('\n')).not.toContain(TOKEN);
  });

  it.each([
    ['GET', 401, 'revoked'],
    ['GET', 429, 'rate_limited'],
    ['GET', 503, 'unavailable'],
    ['GET', 500, 'unexpected'],
    ['DELETE', 401, 'revoked'],
    ['DELETE', 429, 'rate_limited'],
    ['DELETE', 503, 'unavailable'],
    ['DELETE', 500, 'unexpected'],
    ['DELETE', 404, 'not_found'],
  ] as const)('reports %s %s as %s without printing the token', async (method, status, code) => {
    replies[method] = { status };
    expect(await runSiteDelete({ ...opts, yes: true, json: true }, deps())).toBe(1);
    expect(outLines).toHaveLength(1);
    expect(JSON.parse(outLines[0] as string)).toMatchObject({ event: 'error', code });
    expect(errLines).toEqual([]);
    if (method === 'GET') expect(deletes()).toHaveLength(0);
    if (status === 404)
      expect(JSON.parse(outLines[0] as string).message).toBe('No site named "my-app".');
    expect(outLines.join('\n')).not.toContain(TOKEN);
  });

  it('refuses a malformed list response before confirmation or deletion', async () => {
    replies.GET.body = { sites: [] };
    const ask = vi.fn(async () => 'my-app');
    expect(await runSiteDelete(opts, { ...deps(), ask })).toBe(1);
    expect(errLines).toEqual([`Unexpected answer from ${API} (200).`]);
    expect(ask).not.toHaveBeenCalled();
    expect(deletes()).toHaveLength(0);
  });

  it('reports missing credentials and an unreachable API without deleting', async () => {
    await rm(path.join(dir, 'credentials.json'));
    expect(await runSiteDelete({ ...opts, yes: true }, deps())).toBe(1);
    expect(errLines).toEqual(['Not signed in. Run npx passback login first.']);
    expect(requests).toHaveLength(0);
    await writeCredentials(path.join(dir, 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: TOKEN,
    });
    const offline = {
      ...deps(),
      fetch: vi.fn(async () => {
        throw new Error('down');
      }) as typeof fetch,
    };
    expect(await runSiteDelete({ ...opts, yes: true }, offline)).toBe(1);
    expect(errLines[1]).toBe(`Cannot reach ${API}.`);
    expect(deletes()).toHaveLength(0);
  });
});
