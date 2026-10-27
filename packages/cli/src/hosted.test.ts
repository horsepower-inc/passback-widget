import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeCredentials } from './credentials';
import {
  commonFailure,
  hostedCall,
  localOrigins,
  readProjectPackages,
  runInitSite,
  siteName,
  type HostedDeps,
} from './hosted';

const TOKEN = 'pbt_secret_token_value';
const API = 'https://api.example.test';

type Recorded = { method: string; url: string; headers: Record<string, string>; body?: string };
type Reply = { status: number; body?: unknown };

function snippet(siteId: string): string {
  return `<script src="x" data-passback-endpoint="https://ingest.example.test/v1/ingest/${siteId}"></script>`;
}

function view(siteId: string, name: string, origins: string[] = ['http://localhost:3000']) {
  return { siteId, name, origins, snippet: snippet(siteId), integration: {}, createdAt: 'now' };
}

describe('hosted init --site', () => {
  let dir: string;
  let requests: Recorded[];
  let outLines: string[];
  let errLines: string[];
  let replies: { GET?: Reply; POST?: Reply; billing?: Reply };
  let throwFetch: boolean;

  function deps(credentialsPath = path.join(dir, 'creds', 'credentials.json')): HostedDeps {
    return {
      credentialsPath,
      out: (line) => outLines.push(line),
      err: (line) => errLines.push(line),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (throwFetch) throw new Error('down');
        const method = init?.method ?? 'GET';
        requests.push({
          method,
          url: String(input),
          headers: init?.headers as Record<string, string>,
          body: init?.body as string | undefined,
        });
        const isBilling = String(input).endsWith('/v1/customer/billing');
        const reply = (isBilling ? replies.billing : replies[method as 'GET' | 'POST']) ?? {
          status: 404,
        };
        const text = reply.body === undefined ? '' : JSON.stringify(reply.body);
        return new Response(text, { status: reply.status });
      }) as typeof fetch,
    };
  }

  async function signIn(): Promise<void> {
    await writeCredentials(path.join(dir, 'creds', 'credentials.json'), {
      v: 1,
      api: API,
      accessToken: TOKEN,
    });
  }

  async function project(name: string, files: Record<string, unknown> = {}): Promise<string> {
    const root = path.join(dir, name);
    await mkdir(root, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), JSON.stringify(content));
    }
    return root;
  }

  const posts = (): Recorded[] => requests.filter((r) => r.method === 'POST');

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'passback-hosted-'));
    requests = [];
    outLines = [];
    errLines = [];
    replies = {};
    throwFetch = false;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('sends the stored token as a bearer and reports a missing sign-in without a request', async () => {
    const missing = await hostedCall(deps(), 'GET', '/v1/customer/sites');
    expect(missing).toEqual({ kind: 'signed_out' });
    expect(requests).toHaveLength(0);
    expect(commonFailure(missing)?.message).toBe('Not signed in. Run npx passback login first.');

    await signIn();
    replies.POST = { status: 201, body: { ok: true } };
    const answer = await hostedCall(deps(), 'POST', '/v1/customer/sites', { name: 'x' });
    expect(answer).toEqual({ kind: 'answer', api: API, status: 201, body: { ok: true } });
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: `${API}/v1/customer/sites`,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'x' }),
    });
  });

  it('reports an unreachable server, a 401 and a 503 in plain sentences', async () => {
    await signIn();
    throwFetch = true;
    const down = await hostedCall(deps(), 'GET', '/v1/customer/sites');
    expect(commonFailure(down)).toEqual({
      code: 'unreachable',
      message: `Cannot reach ${API}.`,
    });
    throwFetch = false;
    replies.GET = { status: 401 };
    const revoked = commonFailure(await hostedCall(deps(), 'GET', '/v1/customer/sites'));
    expect(revoked?.message).toBe('Your sign-in has ended. Run npx passback login.');
    replies.GET = { status: 503 };
    const unavailable = commonFailure(await hostedCall(deps(), 'GET', '/v1/customer/sites'));
    expect(unavailable?.message).toBe(`Hosted Passback is not available on ${API} right now.`);
  });

  it('names the site after the project folder', () => {
    expect(siteName('/work/my-shop/')).toBe('my-shop');
    expect(siteName(`/work/${'a'.repeat(100)}`)).toHaveLength(80);
  });

  it('finds localhost ports in the dev, start and preview scripts and the framework defaults', async () => {
    const root = await project('mono', {
      'package.json': { workspaces: ['apps/*'] },
      'apps/web/package.json': {
        devDependencies: { vite: '^5.0.0' },
        scripts: { dev: 'vite --port 5180', build: 'vite build --port 9999' },
      },
      'apps/site/package.json': { dependencies: { next: '^14.0.0' } },
    });
    expect(localOrigins(await readProjectPackages(root))).toEqual([
      'http://localhost:3000',
      'http://localhost:4173',
      'http://localhost:5173',
      'http://localhost:5180',
    ]);
    expect(localOrigins([])).toEqual(['http://localhost:3000', 'http://localhost:5173']);
  });

  const paying = { state: 'active', subscribed: true, trialEndsAt: null, perMonthCents: 500 };

  it('shows the site count and needs --yes before adding a site that costs money', async () => {
    await signIn();
    const root = await project('shop');
    replies.GET = { status: 200, body: [view('pb_one', 'other'), view('pb_two', 'more')] };
    replies.POST = { status: 201, body: view('pb_abc123', 'shop') };
    replies.billing = { status: 200, body: paying };
    const refused = await runInitSite({ root, json: false }, deps());
    expect(refused.ok).toBe(false);
    expect(posts()).toHaveLength(0);
    expect(errLines).toEqual(['This adds $6 a month. Run again with --yes to add the site.']);
    const made = await runInitSite({ root, json: false, yes: true }, deps());
    expect(made.ok).toBe(true);
    expect(posts()).toHaveLength(1);
    expect(outLines).toContain('3 of 20 sites');
    expect(outLines).toContain('This adds $6 a month');
  });

  it('adds a site without asking during the trial or when billing is off', async () => {
    await signIn();
    const root = await project('shop');
    replies.GET = { status: 200, body: [view('pb_one', 'other')] };
    replies.POST = { status: 201, body: view('pb_abc123', 'shop') };
    const trial = { state: 'trial', subscribed: false, trialEndsAt: null, perMonthCents: 0 };
    for (const billing of [{ status: 200, body: trial }, { status: 404 }]) {
      replies.billing = billing;
      outLines = [];
      expect((await runInitSite({ root, json: false }, deps())).ok).toBe(true);
      expect(outLines).toContain('2 of 20 sites');
      expect(outLines).not.toContain('This adds $6 a month');
    }
    expect(posts()).toHaveLength(2);
  });

  it('says the account is paused when init --site runs', async () => {
    await signIn();
    const root = await project('shop');
    replies.GET = { status: 200, body: [] };
    replies.POST = { status: 201, body: view('pb_abc123', 'shop') };
    replies.billing = {
      status: 200,
      body: { state: 'paused', subscribed: false, trialEndsAt: null, perMonthCents: 0 },
    };
    expect((await runInitSite({ root, json: false }, deps())).ok).toBe(true);
    expect(outLines.slice(-2)).toEqual([
      'Paused — pay to turn your sites back on',
      'Pay with npx passback billing.',
    ]);
    outLines = [];
    await runInitSite({ root, json: true }, deps());
    expect(JSON.parse(outLines[0] ?? '')).toMatchObject({ paused: true, sites: 1, addsCents: 0 });
  });

  it('creates the site with the project origins and prints the key and the endpoint', async () => {
    await signIn();
    const root = await project('shop', {
      'package.json': { dependencies: { next: '^14.0.0' } },
    });
    replies.GET = { status: 200, body: [] };
    replies.POST = { status: 201, body: view('pb_abc123', 'shop') };
    const result = await runInitSite({ root, json: false }, deps());
    expect(result.ok).toBe(true);
    expect(JSON.parse(posts()[0]?.body ?? '{}')).toEqual({
      name: 'shop',
      origins: ['http://localhost:3000'],
    });
    expect(outLines).toEqual([
      'Created site "shop" for http://localhost:3000.',
      'Site key: pb_abc123',
      'Endpoint: https://ingest.example.test',
      '1 of 20 sites',
    ]);
  });

  it('reuses a site with the same name instead of creating a second one', async () => {
    await signIn();
    const root = await project('shop');
    replies.GET = {
      status: 200,
      body: [view('pb_other', 'other'), view('pb_first', 'shop'), view('pb_second', 'shop')],
    };
    const result = await runInitSite({ root, json: false }, deps());
    expect(result).toMatchObject({ ok: true, site: { siteId: 'pb_first' } });
    expect(posts()).toHaveLength(0);
    expect(outLines[0]).toBe('Using the existing site "shop".');
  });

  it('uses the site whose key is given and refuses an unknown key', async () => {
    await signIn();
    const root = await project('shop');
    replies.GET = { status: 200, body: [view('pb_one', 'one'), view('pb_two', 'two')] };
    const used = await runInitSite({ root, json: false, siteKey: 'pb_two' }, deps());
    expect(used).toMatchObject({ ok: true, site: { siteId: 'pb_two' } });
    expect(outLines).toContain('Site key: pb_two');

    outLines.length = 0;
    const refused = await runInitSite({ root, json: false, siteKey: 'pb_nope' }, deps());
    expect(refused).toEqual({ ok: false });
    expect(errLines).toEqual([
      'No site with the key pb_nope in this account. Copy the command again from the dashboard.',
    ]);
    expect(outLines).toEqual([]);
    expect(posts()).toHaveLength(0);
  });

  it('explains the 20-site limit', async () => {
    await signIn();
    const root = await project('shop');
    replies.GET = { status: 200, body: [] };
    replies.POST = { status: 409, body: { code: 'site_limit' } };
    const result = await runInitSite({ root, json: false }, deps());
    expect(result).toEqual({ ok: false });
    expect(errLines).toEqual([
      'This account already has 20 sites, the most it can have. Delete one in the dashboard, then run this again.',
    ]);
  });

  it('prints one JSON line with --json and never the token', async () => {
    await signIn();
    const root = await project('shop');
    replies.GET = { status: 200, body: [] };
    replies.POST = { status: 201, body: view('pb_abc123', 'shop', ['http://localhost:5173']) };
    await runInitSite({ root, json: true }, deps());
    expect(outLines).toHaveLength(1);
    expect(JSON.parse(outLines[0] as string)).toEqual({
      event: 'site',
      created: true,
      siteKey: 'pb_abc123',
      name: 'shop',
      origins: ['http://localhost:5173'],
      endpoint: 'https://ingest.example.test',
      sites: 1,
      addsCents: 0,
      paused: false,
    });

    replies.GET = { status: 401 };
    await runInitSite({ root, json: true }, deps());
    expect(JSON.parse(outLines[1] as string)).toMatchObject({ event: 'error', code: 'revoked' });
    expect([...outLines, ...errLines].join('\n')).not.toContain(TOKEN);
  });
});
