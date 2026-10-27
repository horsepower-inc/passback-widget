import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountDeps,
  DEFAULT_API,
  apiBase,
  runLogin,
  runLogout,
  runWhoami,
} from './account.js';
import { readCredentials, writeCredentials } from './credentials.js';

const API = 'https://api.example.test';
const TOKEN = 'secret-access-token';

type Req = { method: string; path: string; body?: unknown; auth?: string };
type Answer = { status: number; body?: unknown } | 'network';
type Handler = (req: Req) => Answer;

let dir: string;
let credentialsPath: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'passback-account-'));
  credentialsPath = join(dir, 'passback', 'credentials.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(handler: Handler) {
  const requests: Req[] = [];
  const sleeps: number[] = [];
  const opened: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const req: Req = {
      method: init?.method ?? 'GET',
      path: new URL(String(url)).pathname,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      auth: headers.authorization,
    };
    requests.push(req);
    const answer = handler(req);
    if (answer === 'network') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
  }) as typeof fetch;
  const deps: AccountDeps = {
    fetch: fakeFetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    openUrl: (url) => {
      opened.push(url);
    },
    hostname: 'devbox',
    credentialsPath,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  return { deps, requests, sleeps, opened, out, err };
}

const grant = {
  deviceCode: 'dev-code',
  userCode: 'ABCD-1234',
  verificationUri: `${API}/device`,
  expiresIn: 600,
  interval: 5,
};
const me = { user: { id: 'u1', email: 'a@b.test' }, org: { id: 'o1', name: 'Acme' }, csrf: 'c' };

function approvingAfter(pending: Answer[]): Handler {
  const queue = [...pending];
  return (req) => {
    if (req.path === '/v1/auth/device') return { status: 200, body: grant };
    if (req.path === '/v1/auth/device/token') {
      return queue.shift() ?? { status: 200, body: { accessToken: TOKEN } };
    }
    if (req.path === '/v1/customer/me') return { status: 200, body: me };
    return { status: 404 };
  };
}

const pending: Answer = { status: 400, body: { code: 'authorization_pending' } };

describe('account commands', () => {
  it('prints the code and the address, opens the browser and stores the token after approval', async () => {
    const t = setup(approvingAfter([pending]));
    expect(await runLogin({ api: API, json: false }, t.deps)).toBe(0);
    expect(t.out).toEqual([
      'Your code: ABCD-1234',
      `Open ${API}/device and click Approve.`,
      'Signed in as a@b.test (Acme).',
    ]);
    expect(t.opened).toEqual([`${API}/device`]);
    expect(t.requests[0]).toMatchObject({ method: 'POST', body: { name: 'devbox' } });
    expect(t.requests[1]?.body).toEqual({ deviceCode: 'dev-code' });
    expect(t.requests.at(-1)?.auth).toBe(`Bearer ${TOKEN}`);
    expect(t.sleeps).toEqual([5000, 5000]);
    expect(await readCredentials(credentialsPath)).toEqual({
      v: 1,
      api: API,
      accessToken: TOKEN,
    });
    expect(t.out.join('\n')).not.toContain(TOKEN);
  });

  it('slows down by five seconds when the server says slow_down', async () => {
    const t = setup(approvingAfter([{ status: 400, body: { code: 'slow_down' } }, pending]));
    expect(await runLogin({ api: API, json: false }, t.deps)).toBe(0);
    expect(t.sleeps).toEqual([5000, 10000, 10000]);
  });

  it('stops with a plain message when the sign-in is denied', async () => {
    const t = setup(approvingAfter([{ status: 400, body: { code: 'access_denied' } }]));
    expect(await runLogin({ api: API, json: false }, t.deps)).toBe(1);
    expect(t.err).toEqual(['The sign-in was denied in the browser.']);
    expect(await readCredentials(credentialsPath)).toBeUndefined();
  });

  it('stops when the code expires', async () => {
    const server = setup(approvingAfter([{ status: 400, body: { code: 'expired_token' } }]));
    expect(await runLogin({ api: API, json: false }, server.deps)).toBe(1);
    expect(server.err).toEqual(['The code expired. Run passback login again.']);

    const slow = setup((req) =>
      req.path === '/v1/auth/device' ? { status: 200, body: { ...grant, expiresIn: 12 } } : pending,
    );
    expect(await runLogin({ api: API, json: false }, slow.deps)).toBe(1);
    expect(slow.err).toEqual(['The code expired. Run passback login again.']);
    expect(slow.sleeps).toEqual([5000, 5000, 5000]);

    const late = setup((req) => {
      if (req.path === '/v1/auth/device') return { status: 200, body: { ...grant, expiresIn: 10 } };
      return late.requests.filter((r) => r.path === '/v1/auth/device/token').length < 2
        ? pending
        : { status: 200, body: { accessToken: TOKEN } };
    });
    expect(await runLogin({ api: API, json: false }, late.deps)).toBe(1);
    expect(late.err).toEqual(['The code expired. Run passback login again.']);
    expect(late.sleeps).toEqual([5000, 5000]);
    expect(late.requests.filter((r) => r.path === '/v1/auth/device/token')).toHaveLength(1);
    expect(await readCredentials(credentialsPath)).toBeUndefined();
  });

  it('prints one JSON line per event with --json and never the token', async () => {
    const t = setup(approvingAfter([]));
    expect(await runLogin({ api: API, json: true }, t.deps)).toBe(0);
    expect(t.out.map((l) => JSON.parse(l))).toEqual([
      { event: 'code', userCode: 'ABCD-1234', verificationUri: `${API}/device`, expiresIn: 600 },
      { event: 'signed_in', email: 'a@b.test', org: 'Acme' },
    ]);
    expect(t.out.join('\n')).not.toContain(TOKEN);

    const denied = setup(approvingAfter([{ status: 400, body: { code: 'access_denied' } }]));
    expect(await runLogin({ api: API, json: true }, denied.deps)).toBe(1);
    expect(denied.err).toEqual([]);
    expect(JSON.parse(denied.out.at(-1) ?? '')).toEqual({
      event: 'error',
      code: 'access_denied',
      message: 'The sign-in was denied in the browser.',
    });

    const noMe = setup((req) =>
      req.path === '/v1/customer/me' ? { status: 401 } : approvingAfter([])(req),
    );
    expect(await runLogin({ api: API, json: true }, noMe.deps)).toBe(0);
    expect(JSON.parse(noMe.out.at(-1) ?? '')).toEqual({
      event: 'signed_in',
      email: null,
      org: null,
    });
  });

  it('reports an unreachable server without a stack trace', async () => {
    const t = setup(() => 'network');
    expect(await runLogin({ api: API, json: false }, t.deps)).toBe(1);
    expect(t.err).toEqual([`Cannot reach ${API}.`]);

    const busy = setup(() => ({ status: 429 }));
    expect(await runLogin({ api: API, json: false }, busy.deps)).toBe(1);
    expect(busy.err).toEqual([
      'Cannot start the sign-in (the server answered 429). Try again in a minute.',
    ]);

    const odd = setup((req) =>
      req.path === '/v1/auth/device' ? { status: 200, body: grant } : { status: 500 },
    );
    expect(await runLogin({ api: API, json: false }, odd.deps)).toBe(1);
    expect(odd.err).toEqual([`Unexpected answer from ${API} (500).`]);
    expect(await stat(dir).then(() => readCredentials(credentialsPath))).toBeUndefined();
  });

  it('whoami prints the account for a stored token and asks to log in again after a 401', async () => {
    const none = setup(() => ({ status: 500 }));
    expect(await runWhoami({ json: false }, none.deps)).toBe(1);
    expect(none.err).toEqual(['Not signed in. Run passback login.']);

    await writeCredentials(credentialsPath, { v: 1, api: API, accessToken: TOKEN });
    const ok = setup(() => ({ status: 200, body: me }));
    expect(await runWhoami({ json: false }, ok.deps)).toBe(0);
    expect(ok.out).toEqual([`a@b.test · Acme · ${API}`]);
    expect(ok.requests[0]?.auth).toBe(`Bearer ${TOKEN}`);

    const okJson = setup(() => ({ status: 200, body: me }));
    expect(await runWhoami({ json: true }, okJson.deps)).toBe(0);
    expect(JSON.parse(okJson.out[0] ?? '')).toEqual({
      signedIn: true,
      email: 'a@b.test',
      org: 'Acme',
      api: API,
    });

    const revoked = setup(() => ({ status: 401 }));
    expect(await runWhoami({ json: false }, revoked.deps)).toBe(1);
    expect(revoked.err).toEqual(['Your sign-in has ended. Run passback login.']);
    const revokedJson = setup(() => ({ status: 401 }));
    await runWhoami({ json: true }, revokedJson.deps);
    expect(JSON.parse(revokedJson.out[0] ?? '')).toEqual({ signedIn: false, reason: 'revoked' });

    const down = setup(() => 'network');
    expect(await runWhoami({ json: true }, down.deps)).toBe(1);
    expect(JSON.parse(down.out[0] ?? '')).toEqual({ signedIn: null, reason: 'unreachable' });
  });

  it('whoami says the account is paused', async () => {
    await writeCredentials(credentialsPath, { v: 1, api: API, accessToken: TOKEN });
    const billing = { state: 'paused', subscribed: false, trialEndsAt: null, perMonthCents: 0 };
    const handler: Handler = (req) =>
      req.path === '/v1/customer/billing' ? { status: 200, body: billing } : { status: 200, body: me };
    const text = setup(handler);
    expect(await runWhoami({ json: false }, text.deps)).toBe(0);
    expect(text.out).toEqual([
      `a@b.test · Acme · ${API}`,
      'Paused — pay to turn your sites back on',
      'Pay with npx passback billing.',
    ]);
    const json = setup(handler);
    await runWhoami({ json: true }, json.deps);
    expect(JSON.parse(json.out[0] ?? '')).toMatchObject({ signedIn: true, paused: true });
  });

  it('whoami prints only the account when billing is off', async () => {
    await writeCredentials(credentialsPath, { v: 1, api: API, accessToken: TOKEN });
    const handler: Handler = (req) =>
      req.path === '/v1/customer/billing' ? { status: 404 } : { status: 200, body: me };
    const off = setup(handler);
    expect(await runWhoami({ json: false }, off.deps)).toBe(0);
    expect(off.out).toEqual([`a@b.test · Acme · ${API}`]);
    const down = setup((req) => (req.path === '/v1/customer/billing' ? 'network' : handler(req)));
    expect(await runWhoami({ json: false }, down.deps)).toBe(0);
    expect(down.out).toEqual([`a@b.test · Acme · ${API}`]);
  });

  it('logout revokes the token on the server and removes the file even when the server is down', async () => {
    const none = setup(() => ({ status: 500 }));
    expect(await runLogout({ json: false }, none.deps)).toBe(0);
    expect(none.out).toEqual(['Not signed in.']);
    expect(none.requests).toEqual([]);

    await writeCredentials(credentialsPath, { v: 1, api: API, accessToken: TOKEN });
    const ok = setup(() => ({ status: 204 }));
    expect(await runLogout({ json: false }, ok.deps)).toBe(0);
    expect(ok.requests).toEqual([
      {
        method: 'DELETE',
        path: '/v1/customer/tokens/current',
        body: undefined,
        auth: `Bearer ${TOKEN}`,
      },
    ]);
    expect(ok.out).toEqual(['Signed out.']);
    expect(await readCredentials(credentialsPath)).toBeUndefined();

    await writeCredentials(credentialsPath, { v: 1, api: API, accessToken: TOKEN });
    const down = setup(() => 'network');
    expect(await runLogout({ json: true }, down.deps)).toBe(0);
    expect(JSON.parse(down.out[0] ?? '')).toEqual({ signedOut: true });
    expect(await readCredentials(credentialsPath)).toBeUndefined();
  });

  it('takes the API address from the flag, then PASSBACK_API_URL, then the default', () => {
    expect(apiBase('https://flag.test//', { PASSBACK_API_URL: 'https://env.test' })).toBe(
      'https://flag.test',
    );
    expect(apiBase(undefined, { PASSBACK_API_URL: 'https://env.test/' })).toBe('https://env.test');
    expect(apiBase(undefined, {})).toBe(DEFAULT_API);
  });
});
